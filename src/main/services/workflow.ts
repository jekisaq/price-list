import { randomUUID } from 'node:crypto'
import { productFields } from '../../shared/api.ts'
import { mapSourceRow } from '../../shared/mapping.ts'
import type {
  ImportedTable,
  ProcessRequest,
  ProcessResult,
} from '../../shared/api'

// Optional demo source for trying the workflow without a file.
export function demoTable(): ImportedTable {
  return {
    id: randomUUID(),
    name: 'Демонстрационная таблица',
    columns: ['Код товара', 'Название', 'Стоимость'],
    rowNumbers: [2, 3, 4],
    totalRows: 3,
    headerRow: 1,
    warnings: [],
    rows: [
      ['001', 'Блокнот', '120'],
      ['002', 'Ручка', '35'],
      ['003', 'Папка', '80'],
    ],
  }
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

// Money is parsed into integer kopecks; ambiguous punctuation is rejected.
export function parsePrice(value: string): bigint | null {
  const text = normalizeText(value)
  if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(text))
    return null

  const [whole = '', fraction = ''] = text
    .replaceAll(' ', '')
    .replace(',', '.')
    .split('.')
  if (whole.replace(/^0+/, '').length > 10)
    return null

  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  // A fixed ceiling keeps final amounts safe for Number and CSV conversion.
  return cents <= 100_000_000_000n ? cents : null
}

export function calculatePrice(cents: bigint, request: ProcessRequest): number {
  const percent = BigInt(Math.round(request.markup * 100))
  const step = BigInt(Math.round((request.roundingStep ?? 0.01) * 100))
  const numerator = cents * (10_000n + percent)
  const denominator = 10_000n * step
  const mode = request.roundingMode ?? 'nearest'
  const adjustment =
    mode === 'up' ? denominator - 1n : mode === 'down' ? 0n : denominator / 2n
  return Number(((numerator + adjustment) / denominator) * step) / 100
}

export function processTable(
  table: ImportedTable,
  request: ProcessRequest,
): ProcessResult {
  const result: ProcessResult = {
    id: randomUUID(),
    products: [],
    errors: [],
    duplicates: [],
    excludedRows: [],
  }
  const corrections = new Map(
    request.corrections?.map((entry) => [entry.sourceRow, entry.sku]),
  )
  const sourceNumbers = table.rows.map(
    (_, index) => table.rowNumbers[index] ?? index + table.headerRow + 1,
  )
  const availableRows = new Set(sourceNumbers)
  for (const sourceRow of corrections.keys()) {
    if (!availableRows.has(sourceRow))
      throw new Error('Исправление относится к неизвестной строке.')

  }
  const groups = new Map<string, number[]>()
  const normalized = table.rows.map((row, index) => {
    const sourceRow = sourceNumbers[index]!
    const mapped = mapSourceRow(row, request.mapping)
    const sku = normalizeText(corrections.get(sourceRow) ?? mapped.sku ?? '')
    const name = normalizeText(mapped.name ?? '')
    const price = parsePrice(mapped.price ?? '')
    if (!sku)
      result.errors.push(`Строка ${sourceRow}: Артикул — обязательное поле.`)

    if (!name)
      result.errors.push(
        `Строка ${sourceRow}: Наименование — обязательное поле.`,
      )

    if (price === null)
      result.errors.push(
        `Строка ${sourceRow}: Цена — введите число от 0 до 1 000 000 000, не более двух десятичных знаков.`,
      )

    if (sku) {
      const group = groups.get(sku) ?? []
      group.push(index)
      groups.set(sku, group)
    }
    return { sourceRow, sku, name, price }
  })
  const excluded = new Set<number>()
  for (const [sku, indexes] of groups) {
    if (indexes.length < 2)
      continue

    for (const index of indexes) {
      const row = normalized[index]!
      result.duplicates.push({ sourceRow: row.sourceRow, sku, name: row.name })
    }
    const keep =
      request.duplicatePolicy === 'last' ? indexes.at(-1) : indexes[0]
    for (const index of indexes) {
      if (index !== keep)
        excluded.add(index)

    }
    if (!request.duplicatePolicy || request.duplicatePolicy === 'manual')
      result.errors.push(
        `Повторяющийся артикул ${sku}: строки ${indexes.map((index) => normalized[index]!.sourceRow).join(', ')}. Исправьте артикулы или выберите правило обработки дублей.`,
      )

  }
  normalized.forEach((row, index) => {
    if (excluded.has(index)) {
      if (request.duplicatePolicy && request.duplicatePolicy !== 'manual')
        result.excludedRows.push(row.sourceRow)

      return
    }
    if (!row.sku || !row.name || row.price === null)
      return

    result.products.push({
      sku: row.sku,
      name: row.name,
      sourceRow: row.sourceRow,
      originalPrice: Number(row.price) / 100,
      price: calculatePrice(row.price, request),
    })
  })
  return result
}

export function toCsv(result: ProcessResult): string {
  const cell = (value: string) => {
    const safe = /^\s*[=+@-]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  return (
    '\uFEFF' +
    [
      productFields.map((field) => field.label),
      ...result.products.map((product) =>
        productFields.map(({ key }) =>
          key === 'price' ? product.price.toFixed(2) : product[key],
        ),
      ),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  )
}
