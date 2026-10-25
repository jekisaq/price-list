export const channels = {
  import: 'price-list:import',
  process: 'price-list:process',
  export: 'price-list:export',
  getSettings: 'price-list:settings:get',
  saveSettings: 'price-list:settings:save',
} as const

export type Field = 'sku' | 'name' | 'price'
export type Mapping = Record<Field, number>
export interface Settings {
  markup: number
}
export interface ImportedTable {
  id: string
  name: string
  columns: string[]
  rows: string[][]
}
export interface ProcessRequest {
  importId: string
  mapping: Mapping
  markup: number
}
export interface Product {
  sku: string
  name: string
  price: number
}
export interface ProcessResult {
  id: string
  products: Product[]
  errors: string[]
}
export interface ExportResult {
  canceled: boolean
  path?: string
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export interface PriceListApi {
  importTable(request: { source: 'demo' }): Promise<Result<ImportedTable>>
  processTable(request: ProcessRequest): Promise<Result<ProcessResult>>
  exportTable(request: { resultId: string }): Promise<Result<ExportResult>>
  getSettings(): Promise<Result<Settings>>
  saveSettings(request: Settings): Promise<Result<Settings>>
}
