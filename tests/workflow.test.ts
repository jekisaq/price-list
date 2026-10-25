import assert from 'node:assert/strict'
import { test } from 'node:test'
import { settings, processRequest } from '../src/main/validation.ts'
import {
  demoTable,
  processTable,
  toCsv,
} from '../src/main/services/workflow.ts'

test('IPC validation rejects malformed settings and mappings', () => {
  for (const input of [
    null,
    [],
    {},
    { markup: '20' },
    { markup: NaN },
    { markup: Infinity },
    { markup: -1 },
    { markup: 1001 },
  ]) {
    assert.throws(() => settings(input))
  }
  const table = demoTable()
  for (const mapping of [
    { sku: 0, name: 0, price: 2 },
    { sku: -1, name: 1, price: 2 },
    { sku: 0, name: 1, price: 3 },
  ]) {
    assert.throws(() =>
      processRequest({ importId: table.id, mapping, markup: 20 }, 3),
    )
  }
  assert.throws(() =>
    processRequest(
      {
        importId: '../file',
        mapping: { sku: 0, name: 1, price: 2 },
        markup: 20,
      },
      3,
    ),
  )
})

test('processing preserves identifiers and does not compound markup', () => {
  const table = demoTable()
  const request = processRequest(
    { importId: table.id, mapping: { sku: 0, name: 1, price: 2 }, markup: 20 },
    3,
  )
  const first = processTable(table, request)
  assert.deepEqual(first.products, processTable(table, request).products)
  assert.equal(first.products[0]?.sku, '001')
  assert.equal(first.products[0]?.price, 144)
  assert.equal(table.rows[0]?.[2], '120')
})

test('invalid rows and duplicates produce errors instead of silent data loss', () => {
  const table = demoTable()
  table.rows.push(['001', 'Дубль', '1'], ['004', '', '2'], ['005', 'Товар', ''])
  const result = processTable(table, {
    importId: table.id,
    mapping: { sku: 0, name: 1, price: 2 },
    markup: 0,
  })
  assert.equal(result.products.length, 3)
  assert.equal(result.errors.length, 3)
})

test('CSV escapes quotes, delimiters and spreadsheet formulas', () => {
  const csv = toCsv({
    id: 'test',
    errors: [],
    duplicates: [],
    excludedRows: [],
    products: [
      {
        sku: '001',
        name: '=A1;"value"',
        price: 1.5,
        originalPrice: 1.5,
        sourceRow: 2,
      },
    ],
  })
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"001";"\'=A1;""value""";"1.50"'))
})
