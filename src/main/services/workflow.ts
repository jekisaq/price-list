import { randomUUID } from 'node:crypto'
import { productFields } from '../../shared/api.ts'
import { mapSourceRow } from '../../shared/mapping.ts'
import type {
  ImportedTable,
  ProcessRequest,
  ProcessResult,
  Field,
  ValidationIssue,
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
    sourceName: table.name,
    products: [],
    issues: [],
    rows: [],
    summary: {
      processed: table.rows.length,
      valid: 0,
      invalid: 0,
      duplicates: 0,
      excluded: 0,
    },
    duplicates: [],
    excludedRows: [],
  }
  for (const message of table.warnings) {
    result.issues.push({
      severity: 'warning',
      code: 'import',
      sourceRow: null,
      field: null,
      columnIndex: null,
      columnName: '',
      value: '',
      message,
    })
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
  function addIssue(
    sourceRow: number,
    field: Field,
    value: string,
    code: ValidationIssue['code'],
    message: string,
    severity: ValidationIssue['severity'] = 'error',
  ) {
    const columnIndex = request.mapping[field]
    result.issues.push({
      severity,
      code,
      sourceRow,
      field,
      columnIndex,
      columnName: table.columns[columnIndex] ?? '',
      value,
      message,
    })
  }
  const groups = new Map<string, number[]>()
  const normalized = table.rows.map((row, index) => {
    const sourceRow = sourceNumbers[index]!
    const mapped = mapSourceRow(row, request.mapping)
    const rawSku = corrections.get(sourceRow) ?? mapped.sku ?? ''
    const sku = normalizeText(rawSku)
    const name = normalizeText(mapped.name ?? '')
    const rawPrice = mapped.price ?? ''
    const price = parsePrice(rawPrice)
    if (!sku)
      addIssue(
        sourceRow,
        'sku',
        rawSku,
        'required',
        'Артикул — обязательное поле.',
      )

    if (!name)
      addIssue(
        sourceRow,
        'name',
        mapped.name ?? '',
        'required',
        'Наименование — обязательное поле.',
      )

    if (price === null)
      addIssue(
        sourceRow,
        'price',
        rawPrice,
        'price',
        'Цена — введите число от 0 до 1 000 000 000, не более двух десятичных знаков.',
      )

    if (sku) {
      const group = groups.get(sku) ?? []
      group.push(index)
      groups.set(sku, group)
    }
    return { sourceRow, sku, rawSku, name, rawPrice, price }
  })
  const excluded = new Set<number>()
  const duplicateIndexes = new Set<number>()
  for (const [sku, indexes] of groups) {
    if (indexes.length < 2)
      continue

    const manual =
      !request.duplicatePolicy || request.duplicatePolicy === 'manual'
    const keep =
      request.duplicatePolicy === 'last' ? indexes.at(-1)! : indexes[0]!
    const firstRow = normalized[indexes[0]!]!.sourceRow
    for (const index of indexes) {
      const row = normalized[index]!
      duplicateIndexes.add(index)
      result.duplicates.push({ sourceRow: row.sourceRow, sku, name: row.name })
      addIssue(
        row.sourceRow,
        'sku',
        row.rawSku,
        'duplicate',
        `Повторяющийся артикул ${sku}: найден в ${indexes.length} строках, первая строка ${firstRow}. ${manual ? 'Исправьте артикулы или выберите правило обработки дублей.' : 'Применено выбранное правило обработки дублей.'}`,
        manual ? 'error' : 'warning',
      )
      if (!manual && index !== keep) {
        excluded.add(index)
        addIssue(
          row.sourceRow,
          'sku',
          row.rawSku,
          'excluded',
          `Строка исключена. Сохранена строка ${normalized[keep]!.sourceRow} по правилу «${request.duplicatePolicy === 'last' ? 'Оставить последнюю строку' : 'Оставить первую строку'}».`,
          'warning',
        )
      }
    }
  }
  const invalidRows = new Set(
    result.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.sourceRow),
  )
  normalized.forEach((row, index) => {
    const hasErrors = invalidRows.has(row.sourceRow)
    const originalPrice = row.price === null ? null : Number(row.price) / 100
    const price = row.price === null ? null : calculatePrice(row.price, request)
    result.rows.push({
      sourceRow: row.sourceRow,
      sku: row.sku,
      name: row.name,
      rawPrice: row.rawPrice,
      originalPrice,
      price,
      duplicate: duplicateIndexes.has(index),
      excluded: excluded.has(index),
      hasErrors,
    })
    if (excluded.has(index))
      result.excludedRows.push(row.sourceRow)

    if (
      hasErrors ||
      excluded.has(index) ||
      originalPrice === null ||
      price === null
    )
      return

    result.products.push({
      sku: row.sku,
      name: row.name,
      sourceRow: row.sourceRow,
      originalPrice,
      price,
    })
  })
  result.summary.invalid = invalidRows.size
  result.summary.valid = table.rows.length - invalidRows.size
  result.summary.duplicates = duplicateIndexes.size
  result.summary.excluded = excluded.size
  return result
}

function serializeCsv(rows: string[][]): string {
  const cell = (value: string) => {
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  return '\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n')
}

export function toCsv(result: ProcessResult): string {
  return serializeCsv([
    productFields.map((field) => field.label),
    ...result.products.map((product) =>
      productFields.map(({ key }) =>
        key === 'price' ? product.price.toFixed(2) : product[key],
      ),
    ),
  ])
}

export function toReportCsv(result: ProcessResult): string {
  const excludedRows = new Set(result.excludedRows)
  return serializeCsv([
    [
      'Файл',
      'Строка',
      'Номер колонки',
      'Колонка',
      'Поле',
      'Значение',
      'Уровень',
      'Причина',
      'Исключена',
    ],
    ...result.issues.map((issue) => [
      result.sourceName,
      issue.sourceRow === null ? '' : String(issue.sourceRow),
      issue.columnIndex === null ? '' : String(issue.columnIndex + 1),
      issue.columnName,
      productFields.find((field) => field.key === issue.field)?.label ?? '',
      issue.value,
      issue.severity === 'error' ? 'Ошибка' : 'Предупреждение',
      issue.message,
      issue.sourceRow !== null && excludedRows.has(issue.sourceRow)
        ? 'Да'
        : 'Нет',
    ]),
  ])
}
