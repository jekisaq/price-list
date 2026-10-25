import { productFields } from './api.ts'
import type { DraftMapping, SupplierProfile } from './api'

const headerKey = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()

export function restoreProfileMapping(
  profile: SupplierProfile,
  columns: string[],
): { mapping: DraftMapping; warning: string | null } {
  const mapping: DraftMapping = { sku: null, name: null, price: null }
  const missing: string[] = []
  for (const { key, label } of productFields) {
    const saved = profile.columns[profile.mapping[key]]
    const candidates = columns.flatMap((column, index) =>
      saved !== undefined && headerKey(column) === headerKey(saved)
        ? [index]
        : [],
    )
    if (candidates.length === 1) {
      mapping[key] = candidates[0]!
    } else {
      missing.push(label)
    }
  }
  const used = new Set<number>()
  for (const { key, label } of productFields) {
    const index = mapping[key]
    if (index !== null && used.has(index)) {
      mapping[key] = null
      missing.push(label)
    } else if (index !== null) {
      used.add(index)
    }
  }
  if (missing.length)
    return {
      mapping,
      warning: `Профиль «${profile.name}»: отсутствуют или неоднозначны колонки для полей: ${missing.join(', ')}. Выберите их вручную и обновите профиль.`,
    }

  const moved = productFields.some(
    ({ key }) => mapping[key] !== profile.mapping[key],
  )
  return {
    mapping,
    warning: moved
      ? 'Порядок колонок изменился. Сопоставление профиля восстановлено по заголовкам.'
      : null,
  }
}
