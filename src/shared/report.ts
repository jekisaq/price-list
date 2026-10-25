import type { ProcessResult, ProcessedRow } from './api'

export type ReportFilter =
  'all' | 'errors' | 'duplicates' | 'warnings' | 'excluded' | 'ready'

export function filterReportRows(
  result: ProcessResult,
  filter: ReportFilter,
): ProcessedRow[] {
  const warningRows = new Set(
    result.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.sourceRow),
  )
  return result.rows.filter((row) => {
    switch (filter) {
      case 'errors':
        return row.hasErrors
      case 'duplicates':
        return row.duplicate
      case 'warnings':
        return warningRows.has(row.sourceRow)
      case 'excluded':
        return row.excluded
      case 'ready':
        return !row.hasErrors && !row.excluded
      default:
        return true
    }
  })
}
