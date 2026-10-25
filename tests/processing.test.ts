import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calculatePrice,
  demoTable,
  normalizeText,
  parsePrice,
  processTable,
  toCsv,
} from '../src/main/services/workflow.ts'
import { processRequest, settings } from '../src/main/validation.ts'
import type { ProcessRequest } from '../src/shared/api.ts'

const request: ProcessRequest = {
  importId: '',
  mapping: { sku: 0, name: 1, price: 2 },
  markup: 20,
}

test('prices accept decimal comma/dot and grouped Unicode spaces, including zero', () => {
  for (const value of ['1 234,56', '1\u00a0234.56', ' 1\u202f234,56 ']) {
    assert.equal(parsePrice(value), 123456n)
  }
  assert.equal(parsePrice('00001,2'), 120n)
  assert.equal(parsePrice('0'), 0n)
  assert.equal(parsePrice('1 000 000 000'), 100000000000n)
  for (const value of [
    '',
    ' ',
    '-1',
    '+1',
    '0x10',
    '1e3',
    'Infinity',
    'NaN',
    '1,234.56',
    '1.234,56',
    '12 34',
    '1,234',
    '1,',
    '12 руб.',
    '1000000000.01',
    '9'.repeat(10000),
  ]) {
    assert.equal(parsePrice(value), null, value.slice(0, 40))
  }
})

test('text normalization preserves case and leading zeros, prices have field-specific errors', () => {
  assert.equal(normalizeText('  00a\u00a0  1  '), '00a 1')
  const table = demoTable()
  table.rows = [
    [' 001 ', ' Блокнот\t А5 ', '1 234,56'],
    ['001', 'Дубль', '0'],
    ['001a', 'Товар', '1'],
    ['001A', 'Товар', '1'],
    ['', '', '-1'],
  ]
  const result = processTable(table, request)
  assert.equal(result.products[0]?.name, 'Блокнот А5')
  assert.equal(result.products[0]?.originalPrice, 1234.56)
  assert.equal(result.products[0]?.price, 1481.47)
  assert.equal(result.duplicates.length, 2)
  assert.equal(result.products.length, 3)
  assert.ok(result.errors.some((error) => error.includes('Артикул —')))
  assert.ok(result.errors.some((error) => error.includes('Наименование —')))
  assert.ok(result.errors.some((error) => error.includes('Цена —')))
})

test('rounding uses exact integer arithmetic, including half-cent ties and step boundaries', () => {
  assert.equal(calculatePrice(100n, { ...request, markup: 0.5 }), 1.01)
  assert.equal(
    calculatePrice(100n, { ...request, markup: 0.5, roundingMode: 'down' }),
    1,
  )
  assert.equal(calculatePrice(5n, { ...request, markup: 10 }), 0.06)
  assert.equal(
    calculatePrice(1250n, { ...request, markup: 0, roundingStep: 1 }),
    13,
  )
  assert.equal(
    calculatePrice(1250n, {
      ...request,
      markup: 0,
      roundingStep: 10,
      roundingMode: 'up',
    }),
    20,
  )
  assert.equal(
    calculatePrice(1250n, {
      ...request,
      markup: 0,
      roundingStep: 10,
      roundingMode: 'down',
    }),
    10,
  )
  assert.equal(
    calculatePrice(1000n, {
      ...request,
      markup: 0,
      roundingStep: 10,
      roundingMode: 'up',
    }),
    10,
  )
  assert.equal(calculatePrice(0n, { ...request, roundingMode: 'up' }), 0)
  assert.equal(
    calculatePrice(100000000000n, { ...request, markup: 1000 }),
    11000000000,
  )
})

test('duplicate rules select source order and disclose excluded physical rows', () => {
  const table = demoTable()
  table.rows = [
    ['001', 'Первый', '10'],
    ['001', 'Последний', '20'],
    ['002', 'Другой', '1'],
  ]
  table.rowNumbers = [5, 9, 12]
  const snapshot = structuredClone(table)
  const first = processTable(table, { ...request, duplicatePolicy: 'first' })
  const last = processTable(table, { ...request, duplicatePolicy: 'last' })
  assert.deepEqual(first.excludedRows, [9])
  assert.deepEqual(last.excludedRows, [5])
  assert.equal(first.products[0]?.price, 12)
  assert.equal(last.products[0]?.price, 24)
  assert.equal(last.errors.length, 0)
  assert.deepEqual(table, snapshot)
  table.rows[0]![2] = '-1'
  assert.ok(
    processTable(table, { ...request, duplicatePolicy: 'last' }).errors.length >
      0,
  )
})

test('manual corrections resolve duplicates without mutating the source or compounding markup', () => {
  const table = demoTable()
  table.rows.push(['001', 'Другой товар', '1,05'])
  table.rowNumbers.push(8)
  const snapshot = structuredClone(table)
  assert.equal(processTable(table, request).errors.length, 1)
  const corrected = { ...request, corrections: [{ sourceRow: 8, sku: '004' }] }
  const result = processTable(table, corrected)
  assert.equal(result.errors.length, 0)
  assert.equal(result.duplicates.length, 0)
  assert.equal(result.products[3]?.price, 1.26)
  assert.deepEqual(result.products, processTable(table, corrected).products)
  assert.equal(
    processTable(table, { ...corrected, markup: 0 }).products[3]?.price,
    1.05,
  )
  assert.ok(toCsv(result).includes('"004";"Другой товар";"1.26"'))
  assert.deepEqual(table, snapshot)
  assert.throws(() =>
    processTable(table, {
      ...request,
      corrections: [{ sourceRow: 999, sku: 'x' }],
    }),
  )
})

test('IPC rejects invalid rounding, duplicate policies, markup precision and corrections', () => {
  for (const change of [
    { roundingStep: 0 },
    { roundingStep: '1' },
    { roundingMode: 'floor' },
    { roundingMode: ['up'] },
    { duplicatePolicy: 'ignore' },
    { duplicatePolicy: ['first'] },
    { markup: 1.001 },
  ]) {
    assert.throws(() => settings({ ...request, ...change }))
  }
  const table = demoTable()
  for (const corrections of [
    {},
    [null],
    [{ sourceRow: 1.5, sku: 'a' }],
    [{ sourceRow: 2, sku: 1 }],
    [
      { sourceRow: 2, sku: 'a' },
      { sourceRow: 2, sku: 'b' },
    ],
  ]) {
    assert.throws(() =>
      processRequest({ ...request, importId: table.id, corrections }, 3),
    )
  }
  const valid = processRequest(
    {
      ...request,
      importId: table.id,
      corrections: [{ sourceRow: 2, sku: '002' }],
    },
    3,
  )
  assert.deepEqual(valid.corrections, [{ sourceRow: 2, sku: '002' }])
})
