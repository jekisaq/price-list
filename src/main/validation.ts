import type {
  ImportOptions,
  ExportFormat,
  ProcessRequest,
  ProcessResult,
  Settings,
} from '../shared/api'
import { validateMapping } from '../shared/mapping.ts'

export function importOptions(value: unknown): ImportOptions {
  const data = object(value)
  if (
    data.delimiter !== ',' &&
    data.delimiter !== ';' &&
    data.delimiter !== '\t'
  )
    throw new Error('Выберите допустимый разделитель CSV.')

  if (
    data.encoding !== 'utf-8' &&
    data.encoding !== 'windows-1251' &&
    data.encoding !== 'utf-16le'
  )
    throw new Error('Выберите допустимую кодировку CSV.')

  if (typeof data.sheet !== 'string' || data.sheet.length > 100)
    throw new Error('Некорректное имя листа.')

  if (
    typeof data.headerRow !== 'number' ||
    !Number.isInteger(data.headerRow) ||
    data.headerRow < 1 ||
    data.headerRow > 100_000
  )
    throw new Error(
      'Строка заголовков должна быть целым числом от 1 до 100 000.',
    )

  return {
    delimiter: data.delimiter,
    encoding: data.encoding,
    sheet: data.sheet,
    headerRow: data.headerRow,
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ожидался объект запроса.')

  return value as Record<string, unknown>
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
    throw new Error('Некорректный идентификатор операции.')

  return value
}

export function currentResult(
  value: unknown,
  result: ProcessResult | undefined,
): ProcessResult {
  const id = identifier(object(value).resultId)
  if (!result || result.id !== id)
    throw new Error('Результат устарел. Выполните проверку таблицы снова.')

  return result
}

export function exportFormat(value: unknown): ExportFormat {
  const { format } = object(value)
  if (format !== 'csv' && format !== 'xlsx')
    throw new Error('Выберите формат экспорта CSV или XLSX.')

  return format
}

export function productExport(
  value: unknown,
  result: ProcessResult | undefined,
): ProcessResult {
  const snapshot = currentResult(value, result)
  const { confirmExcluded } = object(value)
  if (confirmExcluded !== undefined && typeof confirmExcluded !== 'boolean')
    throw new Error('Некорректное подтверждение пропуска строк.')

  if (
    snapshot.issues.some((issue) => issue.severity === 'error') ||
    !snapshot.products.length
  )
    throw new Error('Исправьте ошибки перед экспортом.')

  if (snapshot.excludedRows.length > 0 && confirmExcluded !== true)
    throw new Error('Подтвердите пропуск исключённых строк перед экспортом.')

  return snapshot
}

export function settings(value: unknown): Settings {
  const {
    markup,
    duplicatePolicy = 'manual',
    roundingMode = 'nearest',
    roundingStep = 0.01,
  } = object(value)
  if (
    typeof markup !== 'number' ||
    !Number.isFinite(markup) ||
    markup < 0 ||
    markup > 1000
  ) {
    throw new Error('Наценка должна быть числом от 0 до 1000%.')
  }
  if (
    duplicatePolicy !== 'manual' &&
    duplicatePolicy !== 'first' &&
    duplicatePolicy !== 'last'
  )
    throw new Error('Некорректное правило обработки дублей.')

  if (
    roundingMode !== 'nearest' &&
    roundingMode !== 'up' &&
    roundingMode !== 'down'
  )
    throw new Error('Некорректный способ округления.')

  if (roundingStep !== 0.01 && roundingStep !== 1 && roundingStep !== 10)
    throw new Error('Некорректный шаг округления.')

  if (!/^\d+(?:\.\d{1,2})?$/.test(String(markup)))
    throw new Error('Укажите наценку с точностью до двух знаков после запятой.')

  return { markup, duplicatePolicy, roundingMode, roundingStep }
}

export function processRequest(
  value: unknown,
  columnCount: number,
): ProcessRequest {
  const data = object(value)
  const validation = validateMapping(data.mapping, columnCount)
  if (!validation.valid)
    throw new Error(Object.values(validation.errors).join(' '))

  const corrections = data.corrections ?? []
  if (!Array.isArray(corrections) || corrections.length > 100_000)
    throw new Error('Некорректный список исправлений.')

  const seen = new Set<number>()
  const validatedCorrections = corrections.map((entry: unknown) => {
    const correction = object(entry)
    if (
      typeof correction.sourceRow !== 'number' ||
      !Number.isSafeInteger(correction.sourceRow) ||
      correction.sourceRow < 1 ||
      typeof correction.sku !== 'string' ||
      correction.sku.length > 1000 ||
      seen.has(correction.sourceRow)
    )
      throw new Error('Некорректное исправление артикула.')

    seen.add(correction.sourceRow)
    return { sourceRow: correction.sourceRow, sku: correction.sku }
  })
  return {
    corrections: validatedCorrections,
    importId: identifier(data.importId),
    mapping: validation.mapping,
    ...settings(data),
  }
}
