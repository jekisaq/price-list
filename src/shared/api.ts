export const channels = {
  openFile: 'price-list:open-file',
  import: 'price-list:import',
  process: 'price-list:process',
  export: 'price-list:export',
  exportReport: 'price-list:export-report',
  getSettings: 'price-list:settings:get',
  saveSettings: 'price-list:settings:save',
  getProfiles: 'price-list:profiles:get',
  saveProfile: 'price-list:profiles:save',
  selectProfile: 'price-list:profiles:select',
  renameProfile: 'price-list:profiles:rename',
  deleteProfile: 'price-list:profiles:delete',
  importPage: 'price-list:import-page',
  reportPage: 'price-list:report-page',
  operation: 'price-list:operation',
  cancelOperation: 'price-list:cancel-operation',
} as const

export const productFields = [
  { key: 'sku', label: 'Артикул', required: true },
  { key: 'name', label: 'Наименование', required: true },
  { key: 'price', label: 'Цена', required: true },
] as const

export type Field = (typeof productFields)[number]['key']
export type Mapping = Record<Field, number>
export type DraftMapping = Record<Field, number | null>
export interface Settings {
  markup: number
  duplicatePolicy?: 'manual' | 'first' | 'last'
  roundingMode?: 'nearest' | 'up' | 'down'
  roundingStep?: 0.01 | 1 | 10
}
export interface ImportedTable {
  id: string
  name: string
  columns: string[]
  rows: string[][]
  rowNumbers: number[]
  totalRows: number
  headerRow: number
  warnings: string[]
}
export type CsvEncoding = 'utf-8' | 'windows-1251' | 'utf-16le'
export type CsvDelimiter = ',' | ';' | '\t'
export interface SourceFile {
  id: string
  name: string
  format: 'csv' | 'xlsx'
  sheets: string[]
}
export interface ImportOptions {
  delimiter: CsvDelimiter
  encoding: CsvEncoding
  sheet: string
  headerRow: number
}
export interface SupplierProfile {
  id: string
  name: string
  format: 'csv' | 'xlsx'
  importOptions: ImportOptions
  columns: string[]
  mapping: Mapping
  settings: Settings
}
export interface ProfilesState {
  profiles: SupplierProfile[]
  activeProfileId: string | null
  settings: Settings
  warning: string | null
  readOnly: boolean
}
export interface SaveProfileRequest {
  profileId?: string
  name: string
  importId: string
  mapping: Mapping
  settings: Settings
}
export type ImportRequest =
  | { source: 'demo' }
  | {
      source: 'file'
      sourceId: string
      options: ImportOptions
    }
export interface ProcessRequest extends Settings {
  importId: string
  mapping: Mapping
  corrections?: { sourceRow: number; sku: string }[]
}
export interface Product {
  sku: string
  name: string
  price: number
  originalPrice: number
  sourceRow: number
}
export interface ProcessResult {
  id: string
  sourceName: string
  products: Product[]
  issues: ValidationIssue[]
  rows: ProcessedRow[]
  summary: {
    processed: number
    valid: number
    invalid: number
    duplicates: number
    excluded: number
  }
  duplicates: { sourceRow: number; sku: string; name: string }[]
  excludedRows: number[]
}
export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: 'required' | 'price' | 'duplicate' | 'excluded' | 'import'
  sourceRow: number | null
  field: Field | null
  columnIndex: number | null
  columnName: string
  value: string
  message: string
}
export interface ProcessedRow {
  sourceRow: number
  sku: string
  name: string
  rawPrice: string
  originalPrice: number | null
  price: number | null
  duplicate: boolean
  excluded: boolean
  hasErrors: boolean
}
export type ReportFilter =
  'all' | 'errors' | 'duplicates' | 'warnings' | 'excluded' | 'ready'
export interface ProcessView {
  id: string
  sourceName: string
  summary: ProcessResult['summary']
  productCount: number
  errorCount: number
  warningCount: number
  importWarnings: ValidationIssue[]
  excludedRows: number[]
}
export interface ReportPage {
  rows: ProcessedRow[]
  issues: ValidationIssue[]
  total: number
  offset: number
}
export interface PageRequest {
  id: string
  offset: number
  limit: number
}
export interface OperationProgress {
  id: string
  kind: 'open' | 'import' | 'process' | 'export'
  state: 'running' | 'completed' | 'canceled' | 'failed'
  stage: string
  processedRows: number
  totalRows: number | null
  percent: number | null
  cancellable: boolean
  invalidated?: boolean
  workerHeapBytes?: number
}
export interface ExportRequest {
  resultId: string
  format: ExportFormat
  confirmExcluded?: boolean
}
export type ExportFormat = 'csv' | 'xlsx'
export type ExportResult =
  { canceled: true } | { canceled: false; path: string; count: number }
export type Result<T> =
  { ok: true; value: T } | { ok: false; error: string; canceled?: boolean }
export interface PriceListApi {
  openFile(): Promise<Result<SourceFile | null>>
  importTable(request: ImportRequest): Promise<Result<ImportedTable>>
  processTable(request: ProcessRequest): Promise<Result<ProcessView>>
  importPage(request: PageRequest): Promise<Result<ImportedTable>>
  reportPage(
    request: PageRequest & { filter: ReportFilter },
  ): Promise<Result<ReportPage>>
  onOperation(listener: (progress: OperationProgress) => void): () => void
  cancelOperation(request: { id: string }): Promise<Result<boolean>>
  exportTable(request: ExportRequest): Promise<Result<ExportResult>>
  exportReport(request: { resultId: string }): Promise<Result<ExportResult>>
  getSettings(): Promise<Result<Settings>>
  saveSettings(request: Settings): Promise<Result<Settings>>
  getProfiles(): Promise<Result<ProfilesState>>
  saveProfile(request: SaveProfileRequest): Promise<Result<ProfilesState>>
  selectProfile(request: {
    profileId: string | null
  }): Promise<Result<ProfilesState>>
  renameProfile(request: {
    profileId: string
    name: string
  }): Promise<Result<ProfilesState>>
  deleteProfile(request: { profileId: string }): Promise<Result<ProfilesState>>
}
