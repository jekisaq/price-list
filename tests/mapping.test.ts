import assert from 'node:assert/strict'
import { test } from 'node:test'
import { productFields } from '../src/shared/api.ts'
import {
  mapSourceRow,
  mappingCandidates,
  suggestMapping,
  validateMapping,
} from '../src/shared/mapping.ts'
import { importSource, loadSource } from '../src/main/services/import-file.ts'
import { processRequest } from '../src/main/validation.ts'
import { processTable, toCsv } from '../src/main/services/workflow.ts'

test('standard format has three required fields in a stable order', () => {
  assert.deepEqual(
    productFields.map(({ key, label, required }) => [key, label, required]),
    [
      ['sku', 'Артикул', true],
      ['name', 'Наименование', true],
      ['price', 'Цена', true],
    ],
  )
})

test('suggestions normalize Russian headers and support reordered columns', () => {
  assert.deepEqual(
    suggestMapping([' Код_товара ', 'НАЗВАНИЕ', 'Цена (руб.)', 'Остаток']),
    { sku: 0, name: 1, price: 2 },
  )
  assert.deepEqual(
    suggestMapping(['Категория', 'Цена', 'Наименование', 'Остаток', 'Артикул']),
    { sku: 4, name: 2, price: 1 },
  )
  assert.deepEqual(
    suggestMapping(['Артикул', 'Наименование', 'Цена закупки']),
    { sku: 0, name: 1, price: 2 },
  )
  assert.deepEqual(mappingCandidates(['Категория', 'Остаток', 'Примечание']), {
    sku: [],
    name: [],
    price: [],
  })
  assert.deepEqual(
    suggestMapping(['Артикул', 'Описание позиции', 'Стоимость']),
    {
      sku: 0,
      name: null,
      price: 2,
    },
  )
})

test('unknown and ambiguous columns remain unselected, never guessed by position', () => {
  assert.deepEqual(suggestMapping(['Первый', 'Второй', 'Третий']), {
    sku: null,
    name: null,
    price: null,
  })
  assert.deepEqual(suggestMapping(['Артикул', 'Название', 'Цена', 'Цена']), {
    sku: 0,
    name: 1,
    price: null,
  })
  assert.deepEqual(
    suggestMapping(['Артикул', 'Код товара', 'Название', 'Стоимость']),
    { sku: null, name: 2, price: 3 },
  )
  assert.deepEqual(mappingCandidates(['Цена', 'Стоимость']).price, [0, 1])
  assert.deepEqual(suggestMapping(['Артикул']), {
    sku: 0,
    name: null,
    price: null,
  })
})

test('required, duplicate, invalid, fractional and stale indexes are rejected on both sides', () => {
  const id = '00000000-0000-0000-0000-000000000000'
  for (const mapping of [
    null,
    [],
    {},
    { sku: null, name: 1, price: 2 },
    { sku: 0, name: 0, price: 2 },
    { sku: 0, name: 1, price: 3 },
    { sku: '0', name: 1, price: 2 },
    { sku: 0, name: 1, price: NaN },
    { sku: 0, name: 1, price: 1.5 },
    { sku: -1, name: 1, price: 2 },
  ]) {
    assert.equal(validateMapping(mapping, 3).valid, false)
    assert.throws(() => processRequest({ importId: id, mapping, markup: 0 }, 3))
  }
  const duplicate = validateMapping({ sku: 0, name: 0, price: 2 }, 3)
  assert.ok(duplicate.errors.sku)
  assert.ok(duplicate.errors.name)
  assert.equal(validateMapping({ sku: 0, name: 1, price: 2 }, 3).valid, true)
})

test('mapping preview preserves raw strings, leading zeros, blank and unmapped distinctions', () => {
  const row = ['ignored', '149,90', 'Ручка', '000001']
  assert.deepEqual(mapSourceRow(row, { sku: 3, name: 2, price: 1 }), {
    sku: '000001',
    name: 'Ручка',
    price: '149,90',
  })
  assert.deepEqual(
    mapSourceRow(['0001', '', ''], { sku: 0, name: null, price: 2 }),
    { sku: '0001', name: null, price: '' },
  )
  assert.equal(row[0], 'ignored')
})

test('reordered supplier exports only the standard fields', async () => {
  const source = await loadSource('samples/csv/supplier-reordered.csv')
  const table = importSource(source, {
    delimiter: ',',
    encoding: 'utf-8',
    sheet: '',
    headerRow: 1,
  })
  const request = processRequest(
    { importId: table.id, mapping: { sku: 4, name: 2, price: 1 }, markup: 0 },
    table.columns.length,
  )
  const result = processTable(table, request)
  assert.equal(result.errors.length, 0)
  assert.deepEqual(result.products[0], {
    sku: 'ST-0001',
    name: 'Блокнот А5',
    price: 120,
    originalPrice: 120,
    sourceRow: 2,
  })
  const csv = toCsv(result)
  assert.ok(csv.startsWith('\uFEFF"Артикул";"Наименование";"Цена"'))
  assert.ok(csv.includes('"ST-0001";"Блокнот А5";"120.00"'))
  assert.ok(!csv.includes('Канцтовары'))
  assert.ok(!csv.includes('Остаток'))
})
