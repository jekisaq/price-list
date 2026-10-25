import type { ImportOptions, ProcessRequest, Settings } from '../shared/api'
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

export function settings(value: unknown): Settings {
  const { markup } = object(value)
  if (
    typeof markup !== 'number' ||
    !Number.isFinite(markup) ||
    markup < 0 ||
    markup > 1000
  ) {
    throw new Error('Наценка должна быть числом от 0 до 1000%.')
  }
  return { markup }
}

export function processRequest(
  value: unknown,
  columnCount: number,
): ProcessRequest {
  const data = object(value)
  const validation = validateMapping(data.mapping, columnCount)
  if (!validation.valid)
    throw new Error(Object.values(validation.errors).join(' '))

  return {
    importId: identifier(data.importId),
    mapping: validation.mapping,
    ...settings(data),
  }
}
