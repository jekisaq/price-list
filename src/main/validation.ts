import type { ProcessRequest, Settings } from '../shared/api'

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
  const mapping = object(data.mapping)
  const indexes = [mapping.sku, mapping.name, mapping.price]
  if (
    indexes.some(
      (index) =>
        typeof index !== 'number' ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= columnCount,
    )
  ) {
    throw new Error('Для каждого поля нужно выбрать существующую колонку.')
  }
  
  if (new Set(indexes).size !== 3)
    throw new Error('Выберите разные колонки для каждого поля.')

  return {
    importId: identifier(data.importId),
    mapping: {
      sku: mapping.sku as number,
      name: mapping.name as number,
      price: mapping.price as number,
    },
    ...settings(data),
  }
}
