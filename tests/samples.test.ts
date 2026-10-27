import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { loadSource, importSource } from '../src/main/services/import-file.ts'
import { processTable } from '../src/main/services/workflow.ts'

const options = {
  delimiter: ',' as const,
  encoding: 'utf-8' as const,
  sheet: 'Товары',
  headerRow: 1,
}
const request = {
  importId: '',
  mapping: { sku: 0, name: 1, price: 2 },
  markup: 20,
}

test('reusable XLSX samples retain Cyrillic and zero-prefixed SKUs with typed prices', async () => {
  const table = importSource(
    await loadSource(resolve('samples/xlsx/supplier-basic.xlsx')),
    options,
  )
  const result = processTable(table, request)
  assert.equal(result.products.length, 3)
  assert.equal(result.issues.length, 0)
  assert.equal(result.products[0]?.sku, '000001')
  assert.equal(result.products[0]?.price, 144)
  assert.equal(result.products[2]?.name, 'Папка «Документы»')
  assert.equal(result.products[2]?.price, 179.88)
})

test('reusable invalid XLSX sample exercises each required field, bad prices and duplicates', async () => {
  const table = importSource(
    await loadSource(resolve('samples/xlsx/supplier-invalid.xlsx')),
    options,
  )
  const result = processTable(table, request)
  assert.equal(result.summary.processed, 7)
  assert.equal(result.summary.invalid, 7)
  assert.equal(result.summary.duplicates, 2)
  for (const field of ['sku', 'name']) {
    assert.ok(
      result.issues.some(
        (issue) => issue.code === 'required' && issue.field === field,
      ),
    )
  }
  assert.equal(
    result.issues.filter((issue) => issue.code === 'price').length,
    3,
  )
})

test('CSV and XLSX duplicate samples share the same first/last policy results', async () => {
  for (const format of ['csv', 'xlsx']) {
    const table = importSource(
      await loadSource(
        resolve(`samples/${format}/supplier-duplicates.${format}`),
      ),
      options,
    )
    assert.equal(processTable(table, request).summary.duplicates, 2)
    const first = processTable(table, { ...request, duplicatePolicy: 'first' })
    const last = processTable(table, { ...request, duplicatePolicy: 'last' })
    assert.equal(first.products.length, 2)
    assert.deepEqual(first.excludedRows, [3])
    assert.equal(first.products[0]?.price, 12)
    assert.deepEqual(last.excludedRows, [2])
    assert.equal(last.products[0]?.price, 24)
  }
})
