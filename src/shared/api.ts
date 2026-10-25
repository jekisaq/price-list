export const channels = {
  openFile: 'price-list:open-file',
  import: 'price-list:import',
  process: 'price-list:process',
  export: 'price-list:export',
  getSettings: 'price-list:settings:get',
  saveSettings: 'price-list:settings:save',
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
  products: Product[]
  errors: string[]
  duplicates: { sourceRow: number; sku: string; name: string }[]
  excludedRows: number[]
}
export interface ExportResult {
  canceled: boolean
  path?: string
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export interface PriceListApi {
  openFile(): Promise<Result<SourceFile | null>>
  importTable(request: ImportRequest): Promise<Result<ImportedTable>>
  processTable(request: ProcessRequest): Promise<Result<ProcessResult>>
  exportTable(request: { resultId: string }): Promise<Result<ExportResult>>
  getSettings(): Promise<Result<Settings>>
  saveSettings(request: Settings): Promise<Result<Settings>>
}
