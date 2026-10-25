import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { parse } from 'csv-parse/sync'
import {
  destinationPath,
  saveFile,
  savePriceList,
  toXlsx,
  writeErrorMessage,
} from '../src/main/services/export-file.ts'
import {
  demoTable,
  processTable,
  toCsv,
} from '../src/main/services/workflow.ts'
import { importSource, loadSource } from '../src/main/services/import-file.ts'
import { exportFormat } from '../src/main/validation.ts'

function priceList(markup = 20) {
  const table = demoTable()
  table.rows = [
    ['000001', 'Блокнот; "А5"', '1,25'],
    ['=A1', '@Товар', '0'],
    ['001234567890123456789', 'Товар', '1000000000'],
  ]
  return processTable(table, {
    importId: table.id,
    mapping: { sku: 0, name: 1, price: 2 },
    markup,
  })
}

async function withDirectory(action: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'price-list-export-'))
  try {
    await action(directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('XLSX preserves literal strings, leading zeros, long identifiers and numeric prices', async () => {
  const result = priceList()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(new Uint8Array(await toXlsx(result)).buffer)
  assert.equal(workbook.worksheets.length, 1)
  const sheet = workbook.worksheets[0]!
  assert.equal(sheet.name, 'Прайс-лист')
  assert.equal(sheet.columnCount, 3)
  assert.deepEqual(
    [1, 2, 3].map((index) => sheet.getRow(1).getCell(index).value),
    ['Артикул', 'Наименование', 'Цена'],
  )
  result.products.forEach((product, index) => {
    const row = sheet.getRow(index + 2)
    assert.equal(row.getCell(1).value, product.sku)
    assert.equal(row.getCell(1).type, ExcelJS.ValueType.String)
    assert.equal(row.getCell(1).numFmt, '@')
    assert.equal(row.getCell(2).value, product.name)
    assert.equal(row.getCell(2).type, ExcelJS.ValueType.String)
    assert.equal(row.getCell(3).type, ExcelJS.ValueType.Number)
    assert.equal(row.getCell(3).value, product.price)
    assert.equal(row.getCell(3).numFmt, '0.00')
    assert.equal(row.getCell(1).formula, undefined)
    assert.equal(row.getCell(2).formula, undefined)
  })
  assert.equal(sheet.getCell('C2').value, 1.5)
  assert.equal(sheet.getCell('C3').value, 0)
  assert.equal(sheet.getCell('C4').value, 1200000000)
})

test('CSV uses standard columns, fixed decimals and protects formula-like text in both columns', () => {
  const result = priceList()
  const inputs = [
    '=A1',
    '+SUM(A1)',
    '-1+2',
    '@A1',
    ' \t=1',
    '\u0000=1',
    'обычный текст',
    '000001',
  ]
  result.products = inputs.map((text, index) => ({
    sku: text,
    name: text,
    price: 1.5,
    originalPrice: 1.5,
    sourceRow: index + 2,
  }))
  const csv = toCsv(result)
  assert.ok(csv.startsWith('\uFEFF"Артикул";"Наименование";"Цена"'))
  const rows = parse(csv, {
    bom: true,
    delimiter: ';',
    columns: true,
  }) as Record<string, string>[]
  inputs.forEach((text, index) => {
    const expected = index < 6 ? `'${text}` : text
    assert.equal(rows[index]?.['Артикул'], expected)
    assert.equal(rows[index]?.['Наименование'], expected)
    assert.equal(rows[index]?.['Цена'], '1.50')
  })
})

test('CSV and XLSX save complete files, replace existing destinations and return actual path/count', async () => {
  await withDirectory(async (directory) => {
    const result = priceList()
    for (const format of ['csv', 'xlsx'] as const) {
      const path = join(directory, `прайс.${format}`)
      await fs.writeFile(path, 'previous contents')
      const exported = await savePriceList(path, format, result)
      assert.deepEqual(exported, { canceled: false, path, count: 3 })
      const bytes = await fs.readFile(path)
      assert.ok(bytes.length > 0)
      assert.notEqual(bytes.toString(), 'previous contents')
      if (format === 'csv') {
        assert.equal(bytes.toString('utf8'), toCsv(result))
      } else {
        assert.equal(bytes.subarray(0, 2).toString(), 'PK')
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(path)
        assert.equal(workbook.worksheets[0]?.rowCount, 4)
      }
    }
    assert.deepEqual((await fs.readdir(directory)).sort(), [
      'прайс.csv',
      'прайс.xlsx',
    ])
  })
})

test('exported CSV and XLSX reopen through the importer with unchanged ordinary identifiers and final prices', async () => {
  await withDirectory(async (directory) => {
    const result = priceList(0)
    // CSV formula protection intentionally adds an apostrophe; test ordinary values here.
    result.products = [result.products[0]!, result.products[2]!]
    for (const format of ['csv', 'xlsx'] as const) {
      const path = join(directory, `прайс.${format}`)
      await savePriceList(path, format, result)
      const source = await loadSource(path)
      const table = importSource(source, {
        delimiter: ';',
        encoding: 'utf-8',
        sheet: 'Прайс-лист',
        headerRow: 1,
      })
      assert.deepEqual(table.columns, ['Артикул', 'Наименование', 'Цена'])
      const reopened = processTable(table, {
        importId: table.id,
        mapping: { sku: 0, name: 1, price: 2 },
        markup: 0,
      })
      assert.equal(reopened.summary.invalid, 0)
      assert.deepEqual(
        reopened.products.map(({ sku, name, price }) => ({ sku, name, price })),
        result.products.map(({ sku, name, price }) => ({ sku, name, price })),
      )
    }
  })
})

test('export format is checked at the IPC boundary and file extension matches actual contents', async () => {
  assert.equal(exportFormat({ format: 'csv' }), 'csv')
  assert.equal(exportFormat({ format: 'xlsx' }), 'xlsx')
  for (const input of [
    null,
    [],
    {},
    { format: 'xls' },
    { format: 'XLSX' },
    { format: ['csv'] },
    { format: 1 },
  ]) {
    assert.throws(() => exportFormat(input), /формат|объект/)
  }
  assert.equal(destinationPath('прайс', 'xlsx'), resolve('прайс.xlsx'))
  assert.equal(destinationPath('ПРАЙС.CSV', 'csv'), resolve('ПРАЙС.CSV'))
  assert.throws(() => destinationPath('прайс.csv', 'xlsx'), /расширением .xlsx/)
  await withDirectory(async (directory) => {
    const path = join(directory, 'existing.csv')
    await fs.writeFile(path, 'unchanged')
    await assert.rejects(
      () => savePriceList(path, 'xlsx', priceList()),
      /расширением .xlsx/,
    )
    assert.equal(await fs.readFile(path, 'utf8'), 'unchanged')
    const exported = await savePriceList(
      join(directory, 'без расширения'),
      'csv',
      priceList(),
    )
    assert.equal(exported.canceled, false)
    if (!exported.canceled)
      assert.equal(exported.path, join(directory, 'без расширения.csv'))

  })
})

test('failed replacement of a busy or protected destination preserves its contents and cleans temporary files', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'existing.csv')
    await fs.writeFile(path, 'original')
    for (const code of ['EBUSY', 'EACCES', 'EPERM', 'EIO']) {
      const replacement = mock.method(fs, 'rename', async () => {
        throw Object.assign(new Error('failure'), { code })
      })
      try {
        await assert.rejects(
          () => savePriceList(path, 'csv', priceList()),
          new RegExp(writeErrorMessage({ code }).replaceAll('.', '\\.')),
        )
        assert.equal(await fs.readFile(path, 'utf8'), 'original')
        assert.deepEqual(await fs.readdir(directory), ['existing.csv'])
      } finally {
        replacement.mock.restore()
      }
    }
    await savePriceList(path, 'csv', priceList())
    assert.ok((await fs.readFile(path, 'utf8')).startsWith('\uFEFF'))
  })
})

test('partial disk-full writes preserve the old file and remove the partial temporary file', async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, 'existing.csv')
    await fs.writeFile(path, 'original')
    const originalOpen = fs.open
    const interception = mock.method(
      fs,
      'open',
      async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args)
        const originalWrite = handle.writeFile.bind(handle)
        mock.method(handle, 'writeFile', async () => {
          await originalWrite('partial')
          throw Object.assign(new Error('full'), { code: 'ENOSPC' })
        })
        return handle
      },
    )
    try {
      await assert.rejects(
        () => saveFile(path, 'complete'),
        /Недостаточно места/,
      )
      assert.equal(await fs.readFile(path, 'utf8'), 'original')
      assert.deepEqual(await fs.readdir(directory), ['existing.csv'])
    } finally {
      interception.mock.restore()
    }
  })
})

test('XLSX rejects oversized cells before replacing an existing file, while CSV supports the text', async () => {
  await withDirectory(async (directory) => {
    const result = priceList()
    result.products[0]!.name = 'я'.repeat(32768)
    const path = join(directory, 'existing.xlsx')
    await fs.writeFile(path, 'original')
    await assert.rejects(() => savePriceList(path, 'xlsx', result), /32 767/)
    assert.equal(await fs.readFile(path, 'utf8'), 'original')
    assert.deepEqual(await fs.readdir(directory), ['existing.xlsx'])
    await savePriceList(join(directory, 'long.csv'), 'csv', result)
    assert.ok(
      (await fs.readFile(join(directory, 'long.csv'), 'utf8')).includes(
        'я'.repeat(32768),
      ),
    )
  })
})

test('file system failures have actionable messages and missing destinations can be retried', async () => {
  for (const [code, expected] of [
    ['EACCES', 'Нет доступа'],
    ['EPERM', 'Нет доступа'],
    ['EROFS', 'Нет доступа'],
    ['EBUSY', 'занят'],
    ['ETXTBSY', 'занят'],
    ['ENOSPC', 'места'],
    ['EDQUOT', 'места'],
    ['ENOENT', 'не найдена'],
    ['ENOTDIR', 'не найдена'],
    ['EISDIR', 'папка'],
    ['ENOTEMPTY', 'папка'],
    ['EIO', 'Не удалось записать'],
  ]) {
    assert.ok(writeErrorMessage({ code }).includes(expected!))
  }
  assert.match(writeErrorMessage(null), /Не удалось записать/)
  await withDirectory(async (directory) => {
    await assert.rejects(
      () =>
        savePriceList(
          join(directory, 'missing', 'file.csv'),
          'csv',
          priceList(),
        ),
      /Папка для сохранения не найдена/,
    )
    assert.deepEqual(await fs.readdir(directory), [])
    await savePriceList(join(directory, 'file.csv'), 'csv', priceList())
  })
})
