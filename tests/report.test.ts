import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'csv-parse/sync'
import {
  demoTable,
  processTable,
  toReportCsv,
} from '../src/main/services/workflow.ts'
import { currentResult, productExport } from '../src/main/validation.ts'
import { filterReportRows } from '../src/shared/report.ts'
import type { ProcessRequest } from '../src/shared/api.ts'

const request: ProcessRequest = {
  importId: '',
  mapping: { sku: 0, name: 1, price: 2 },
  markup: 20,
}

function invalidTable() {
  const table = demoTable()
  table.columns = ['Стоимость', 'Код товара', 'Название']
  table.rows = [
    ['10', '001', 'Первый'],
    ['20', '001', 'Второй'],
    [' не число ', '', ' '],
    ['30', '003', 'Корректный'],
  ]
  table.rowNumbers = [4, 8, 11, 15]
  table.totalRows = table.rows.length
  table.warnings = ['Найдены строки разной ширины.']
  return table
}
const reordered = { ...request, mapping: { price: 0, sku: 1, name: 2 } }

test('report counts unique rows, preserves raw values and mapped source locations', () => {
  const result = processTable(invalidTable(), reordered)
  assert.deepEqual(result.summary, {
    processed: 4,
    valid: 1,
    invalid: 3,
    duplicates: 2,
    excluded: 0,
  })
  assert.equal(
    result.issues.filter((issue) => issue.severity === 'error').length,
    5,
  )
  assert.deepEqual(
    result.products.map((product) => product.sourceRow),
    [15],
  )
  const issue = result.issues.find((entry) => entry.code === 'price')!
  assert.equal(issue.sourceRow, 11)
  assert.equal(issue.columnIndex, 0)
  assert.equal(issue.columnName, 'Стоимость')
  assert.equal(issue.field, 'price')
  assert.equal(issue.value, ' не число ')
  assert.match(issue.message, /Цена/)
  assert.equal(result.rows[2]?.originalPrice, null)
  assert.equal(result.rows[2]?.rawPrice, ' не число ')
  assert.deepEqual(
    result.issues.find((entry) => entry.code === 'import'),
    {
      severity: 'warning',
      code: 'import',
      sourceRow: null,
      field: null,
      columnIndex: null,
      columnName: '',
      value: '',
      message: 'Найдены строки разной ширины.',
    },
  )
})

test('filters show invalid rows even when they have no product, and include every duplicate', () => {
  const result = processTable(invalidTable(), reordered)
  const numbers = (filter: Parameters<typeof filterReportRows>[1]) =>
    filterReportRows(result, filter).map((row) => row.sourceRow)
  assert.deepEqual(numbers('all'), [4, 8, 11, 15])
  assert.deepEqual(numbers('errors'), [4, 8, 11])
  assert.deepEqual(numbers('duplicates'), [4, 8])
  assert.deepEqual(numbers('warnings'), [])
  assert.deepEqual(numbers('excluded'), [])
  assert.deepEqual(numbers('ready'), [15])
  const first = processTable(invalidTable(), {
    ...reordered,
    duplicatePolicy: 'first',
  })
  assert.deepEqual(
    filterReportRows(first, 'warnings').map((row) => row.sourceRow),
    [4, 8],
  )
  assert.deepEqual(
    filterReportRows(first, 'excluded').map((row) => row.sourceRow),
    [8],
  )
  assert.equal(first.summary.invalid, 1)
  assert.equal(first.summary.valid, 3)
  assert.equal(first.summary.excluded, 1)
})

test('warnings allow export, unresolved errors block it, and confirmation cannot bypass errors', () => {
  const table = demoTable()
  table.warnings = ['Заголовок переименован.']
  const clean = processTable(table, request)
  assert.equal(productExport({ resultId: clean.id }, clean), clean)
  const invalid = processTable(invalidTable(), reordered)
  assert.throws(
    () =>
      productExport({ resultId: invalid.id, confirmExcluded: true }, invalid),
    /Исправьте ошибки/,
  )
  const resolved = processTable(invalidTable(), {
    ...reordered,
    duplicatePolicy: 'first',
  })
  assert.throws(
    () =>
      productExport({ resultId: resolved.id, confirmExcluded: true }, resolved),
    /Исправьте ошибки/,
  )
})

test('each new result requires its own exclusion confirmation and stale identifiers fail', () => {
  const table = demoTable()
  table.rows[1]![0] = '001'
  const result = processTable(table, { ...request, duplicatePolicy: 'last' })
  for (const confirmExcluded of [undefined, false]) {
    assert.throws(
      () => productExport({ resultId: result.id, confirmExcluded }, result),
      /Подтвердите пропуск/,
    )
  }
  for (const confirmExcluded of ['true', 1, null, {}]) {
    assert.throws(
      () => productExport({ resultId: result.id, confirmExcluded }, result),
      /Некорректное подтверждение/,
    )
  }
  assert.equal(
    productExport({ resultId: result.id, confirmExcluded: true }, result),
    result,
  )
  const next = processTable(table, { ...request, duplicatePolicy: 'first' })
  assert.throws(
    () => productExport({ resultId: result.id, confirmExcluded: true }, next),
    /устарел/,
  )
  assert.throws(
    () => productExport({ resultId: next.id }, next),
    /Подтвердите пропуск/,
  )
  assert.throws(() => currentResult({ resultId: result.id }, next), /устарел/)
  assert.throws(
    () => currentResult({ resultId: result.id }, undefined),
    /устарел/,
  )
  assert.throws(
    () => currentResult({ resultId: '../file' }, result),
    /идентификатор/,
  )
  assert.throws(() => currentResult(null, result), /объект/)
  assert.equal(currentResult({ resultId: result.id }, result), result)
})

test('error report contains every diagnostic, including global warnings and exclusions', () => {
  const result = processTable(invalidTable(), {
    ...reordered,
    duplicatePolicy: 'last',
  })
  // Viewing a filter does not change what is exported.
  filterReportRows(result, 'errors')
  const csv = toReportCsv(result)
  const rows = parse(csv, {
    bom: true,
    delimiter: ';',
    columns: true,
  }) as Record<string, string>[]
  assert.equal(rows.length, result.issues.length)
  const invalidPrice = rows.find((row) => row['Поле'] === 'Цена')!
  assert.equal(invalidPrice['Файл'], result.sourceName)
  assert.equal(invalidPrice['Строка'], '11')
  assert.equal(invalidPrice['Номер колонки'], '1')
  assert.equal(invalidPrice['Колонка'], 'Стоимость')
  assert.equal(invalidPrice['Значение'], ' не число ')
  assert.equal(invalidPrice['Уровень'], 'Ошибка')
  assert.equal(rows.filter((row) => row['Исключена'] === 'Да').length, 2)
  assert.ok(
    rows.some(
      (row) => row['Строка'] === '' && row['Уровень'] === 'Предупреждение',
    ),
  )
})

test('report CSV safely preserves quotes, semicolons, newlines and formula-like values', () => {
  const table = demoTable()
  table.name = '=Поставщик;"тест"'
  table.rows[0]![2] = ' =1;"x"\nnext'
  const result = processTable(table, request)
  const csv = toReportCsv(result)
  assert.ok(csv.startsWith('\uFEFF'))
  const rows = parse(csv, {
    bom: true,
    delimiter: ';',
    columns: true,
  }) as Record<string, string>[]
  assert.equal(rows[0]?.['Файл'], `'${table.name}`)
  assert.equal(rows[0]?.['Значение'], `'${table.rows[0]![2]}`)
})

test('reprocessing after mapping correction replaces errors and keeps original source numbers', () => {
  const table = demoTable()
  const bad = processTable(table, {
    ...request,
    mapping: { sku: 2, name: 0, price: 1 },
  })
  assert.equal(bad.summary.invalid, 3)
  const good = processTable(table, request)
  assert.equal(good.summary.invalid, 0)
  assert.deepEqual(
    good.rows.map((row) => row.sourceRow),
    [2, 3, 4],
  )
  assert.notEqual(bad.id, good.id)
  assert.equal(good.products[0]?.price, 144)
  assert.equal(bad.summary.invalid, 3)
})

test('empty reports remain valid CSV and empty product sets cannot be exported', () => {
  const result = processTable(demoTable(), request)
  assert.equal(
    parse(toReportCsv(result), { bom: true, delimiter: ';' }).length,
    1,
  )
  result.products = []
  assert.throws(
    () => productExport({ resultId: result.id }, result),
    /Исправьте ошибки/,
  )
})
