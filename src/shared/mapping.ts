import { productFields } from './api.ts'
import type { DraftMapping, Field, Mapping } from './api'

const aliases: Record<Field, readonly string[]> = {
  sku: [
    'артикул',
    'код товара',
    'код',
  ],
  name: [
    'наименование',
    'название',
    'наименование товара',
    'название товара',
    'товар',
  ],
  price: [
    'цена',
    'стоимость',
    'цена закупки',
    'закупочная цена',
    'цена руб',
    'стоимость руб',
    'цена закупки руб',
  ],
}

function normalizeHeader(header: string): string {
  return header
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
}

export function mappingCandidates(columns: string[]): Record<Field, number[]> {
  const candidates: Record<Field, number[]> = { sku: [], name: [], price: [] }
  columns.forEach((column, index) => {
    const normalized = normalizeHeader(column)
    for (const field of productFields) {
      if (aliases[field.key].includes(normalized))
        candidates[field.key].push(index)

    }
  })
  return candidates
}

export function suggestMapping(columns: string[]): DraftMapping {
  const candidates = mappingCandidates(columns)
  const mapping: DraftMapping = { sku: null, name: null, price: null }
  for (const field of productFields) {
    if (candidates[field.key].length === 1)
      mapping[field.key] = candidates[field.key][0] ?? null

  }
  return mapping
}

export type MappingValidation =
  | { valid: true; mapping: Mapping; errors: Partial<Record<Field, string>> }
  | { valid: false; errors: Partial<Record<Field, string>> }

// Shared by renderer and main; runtime validation still applies to IPC input.
export function validateMapping(
  value: unknown,
  columnCount: number,
): MappingValidation {
  const data =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const errors: Partial<Record<Field, string>> = {}
  const used = new Map<number, Field>()
  for (const { key, label } of productFields) {
    const index = data[key]
    if (index === null || index === undefined) {
      errors[key] = `Выберите колонку для поля «${label}».`
    } else if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= columnCount
    ) {
      errors[key] = `Для поля «${label}» выбрана несуществующая колонка.`
    } else {
      const previous = used.get(index)
      if (previous) {
        errors[key] = 'Эта колонка уже выбрана для другого поля.'
        errors[previous] = 'Эта колонка уже выбрана для другого поля.'
      }
      used.set(index, key)
    }
  }
  if (Object.keys(errors).length)
    return { valid: false, errors }

  return {
    valid: true,
    mapping: {
      sku: data.sku as number,
      name: data.name as number,
      price: data.price as number,
    },
    errors,
  }
}

// Mapping only selects source strings. Validation and price conversion happen later.
export function mapSourceRow(
  row: string[],
  mapping: DraftMapping,
): Record<Field, string | null> {
  const result: Record<Field, string | null> = {
    sku: null,
    name: null,
    price: null,
  }
  for (const { key } of productFields) {
    const index = mapping[key]
    if (index !== null && Number.isInteger(index) && index >= 0)
      result[key] = row[index] ?? ''

  }
  return result
}
