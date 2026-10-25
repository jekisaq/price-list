import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import {
  importSource,
  loadSource,
  preview,
} from '../src/main/services/import-file.ts'
import { importOptions } from '../src/main/validation.ts'
import { processTable } from '../src/main/services/workflow.ts'
import type { ImportOptions } from '../src/shared/api'

const defaults: ImportOptions = {
  delimiter: ',',
  encoding: 'utf-8',
  sheet: '',
  headerRow: 1,
}

async function withFile(
  name: string,
  bytes: string | Uint8Array,
  action: (path: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'price-list-import-'))
  try {
    const path = join(directory, name)
    await writeFile(path, bytes)
    await action(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('all sample CSV formats preserve data and physical source row numbers', async () => {
  const basic = importSource(
    await loadSource('samples/csv/supplier-basic.csv'),
    defaults,
  )
  assert.equal(basic.totalRows, 10)
  assert.equal(basic.rows[0]?.[0], '001')
  const russian = importSource(
    await loadSource('samples/csv/supplier-semicolon.csv'),
    { ...defaults, delimiter: ';' },
  )
  assert.equal(russian.rows[0]?.[2], '149,90')
  assert.equal(russian.totalRows, 8)
  const reordered = importSource(
    await loadSource('samples/csv/supplier-reordered.csv'),
    defaults,
  )
  assert.equal(reordered.columns[4], 'SKU')
  const quoted = importSource(
    await loadSource('samples/csv/supplier-quoted.csv'),
    defaults,
  )
  assert.equal(quoted.totalRows, 5)
  assert.equal(quoted.rows[1]?.[1], 'Ручка "Премиум"')
  assert.ok(quoted.rows[3]?.[3]?.includes('\n'))
  assert.deepEqual(quoted.rowNumbers, [2, 3, 4, 5, 7])
})

test('BOM, blank rows, alternate header and multiline records retain row numbers', async () => {
  await withFile(
    'headers.csv',
    '\uFEFFSupplier\r\n\r\nSKU,Name,Price\r\n\r\n001,"multi\r\nline",10\r\n002,Bad,invalid',
    async (path) => {
      const source = await loadSource(path)
      const table = importSource(source, { ...defaults, headerRow: 3 })
      assert.deepEqual(table.rowNumbers, [5, 7])
      const result = processTable(table, {
        importId: table.id,
        mapping: { sku: 0, name: 1, price: 2 },
        markup: 20,
      })
      assert.match(result.errors[0] ?? '', /Строка 7:/)
      assert.throws(
        () => importSource(source, { ...defaults, headerRow: 6 }),
        /заголовков/,
      )
    },
  )
})

test('CSV encodings support Windows-1251 and UTF-16LE, reject invalid UTF-8', async () => {
  const windows = Buffer.concat([
    Buffer.from('SKU,Name,Price\n001,'),
    Buffer.from([0xd0, 0xf3, 0xf7, 0xea, 0xe0]),
    Buffer.from(',35'),
  ])
  await withFile('windows.csv', windows, async (path) => {
    const source = await loadSource(path)
    assert.throws(() => importSource(source, defaults), /кодировку/)
    assert.equal(
      importSource(source, { ...defaults, encoding: 'windows-1251' })
        .rows[0]?.[1],
      'Ручка',
    )
  })
  await withFile(
    'utf16.csv',
    Buffer.from('\uFEFFSKU\tName\tPrice\r\n001\tРучка\t35', 'utf16le'),
    async (path) => {
      const table = importSource(await loadSource(path), {
        ...defaults,
        encoding: 'utf-16le',
        delimiter: '\t',
      })
      assert.equal(table.rows[0]?.[1], 'Ручка')
    },
  )
})

test('preview is bounded but processing uses all rows', async () => {
  const data =
    'SKU,Name,Price\n' +
    Array.from(
      { length: 150 },
      (_, i) => `${String(i).padStart(4, '0')},Product ${i},10`,
    ).join('\n')
  await withFile('many.csv', data, async (path) => {
    const table = importSource(await loadSource(path), defaults)
    assert.equal(preview(table).rows.length, 100)
    assert.equal(preview(table).totalRows, 150)
    assert.equal(table.rows.length, 150)
    assert.equal(
      processTable(table, {
        importId: table.id,
        mapping: { sku: 0, name: 1, price: 2 },
        markup: 0,
      }).products.length,
      150,
    )
  })
})

test('malformed, empty, header-only and unsupported files fail clearly', async () => {
  await withFile('empty.csv', '', async (path) => {
    await assert.rejects(loadSource(path), /пуст/)
  })
  await withFile('wrong.txt', 'hello', async (path) => {
    await assert.rejects(loadSource(path), /CSV и XLSX/)
  })
  await withFile('broken.xlsx', 'not a zip', async (path) => {
    await assert.rejects(loadSource(path), /повреждён/)
  })
  for (const text of [
    '\n\n',
    'SKU,Name,Price\n',
    'SKU,Name,Price\n001,"bad,2',
  ]) {
    await withFile('invalid.csv', text, async (path) => {
      const source = await loadSource(path)
      assert.throws(() => importSource(source, defaults))
    })
  }
})

test('ragged rows, missing headers and duplicate headers are explicit', async () => {
  await withFile(
    'ragged.csv',
    'SKU,Name,Name\n001,A,B,10\n002,C',
    async (path) => {
      const table = importSource(await loadSource(path), defaults)
      assert.equal(table.columns[3], 'Колонка 4')
      assert.deepEqual(table.rows[1], ['002', 'C', '', ''])
      assert.equal(table.warnings.length, 3)
    },
  )
})

test('XLSX sheet and header selection preserve text, formatted SKUs and formula results', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Пустой')
  const sheet = workbook.addWorksheet('Прайс')
  sheet.addRow(['Supplier'])
  sheet.addRow(['SKU', 'Name', 'Price'])
  sheet.addRow(['0007', { richText: [{ text: 'Ручка' }] }, 35.5])
  sheet.addRow([8, 'Блокнот', { formula: '100+20', result: 120 }])
  sheet.getCell('A4').numFmt = '0000'
  sheet.addRow(['0009', 'Без результата', { formula: '1+1' }])
  const bytes = await workbook.xlsx.writeBuffer()
  await withFile('supplier.xlsx', new Uint8Array(bytes), async (path) => {
    const source = await loadSource(path)
    assert.deepEqual(source.metadata.sheets, ['Пустой', 'Прайс'])
    assert.throws(
      () => importSource(source, { ...defaults, sheet: 'Пустой' }),
      /пуста/,
    )
    assert.throws(
      () => importSource(source, { ...defaults, sheet: 'Missing' }),
      /не найден/,
    )
    const table = importSource(source, {
      ...defaults,
      sheet: 'Прайс',
      headerRow: 2,
    })
    assert.deepEqual(table.rowNumbers, [3, 4, 5])
    assert.deepEqual(table.rows[0], ['0007', 'Ручка', '35.5'])
    assert.deepEqual(table.rows[1], ['0008', 'Блокнот', '120'])
    assert.equal(table.rows[2]?.[2], '#NO_CACHED_RESULT')
    assert.equal(table.warnings.length, 1)
  })
})

test('import options reject unsafe or nonsensical values', () => {
  for (const value of [
    null,
    {},
    { ...defaults, headerRow: 0 },
    { ...defaults, headerRow: 1.5 },
    { ...defaults, delimiter: '||' },
    { ...defaults, encoding: 'base64' },
    { ...defaults, sheet: 1 },
  ]) {
    assert.throws(() => importOptions(value))
  }
  assert.deepEqual(importOptions(defaults), defaults)
})
