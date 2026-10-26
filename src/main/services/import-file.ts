import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import ExcelJS from 'exceljs'
import { parse } from 'csv-parse/sync'
import type { TaskContext } from './task-context'
import type { Cell, Workbook } from 'exceljs'
import type { ImportedTable, ImportOptions, SourceFile } from '../../shared/api'

export const MAX_BYTES = 100 * 1024 * 1024
export const MAX_ROWS = 500_000
export const MAX_COLUMNS = 256
export const MAX_CELLS = 4_000_000
const PREVIEW_ROWS = 100

export interface LoadedSource {
  metadata: SourceFile
  bytes: Buffer
  workbook?: Workbook
}
export interface SourceRow {
  number: number
  values: string[]
}
interface CsvRecord {
  record: string[]
  raw: string
}

export async function loadSource(
  path: string,
  context?: TaskContext,
): Promise<LoadedSource> {
  context?.check()
  context?.progress('Чтение файла', 0)
  const extension = extname(path).toLowerCase()
  if (extension !== '.csv' && extension !== '.xlsx')
    throw new Error('Поддерживаются только файлы CSV и XLSX.')

  const file = await open(path, 'r')
  let bytes: Buffer
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size === 0)
      throw new Error('Файл пуст или не является обычным файлом.')

    if (stat.size > MAX_BYTES)
      throw new Error('Файл больше 100 МиБ. Разделите его на несколько файлов.')

    bytes = await file.readFile()
  } finally {
    await file.close()
  }
  if (bytes.length > MAX_BYTES)
    throw new Error('Файл больше 20 МиБ.')

  const metadata: SourceFile = {
    id: randomUUID(),
    name: basename(path),
    format: extension === '.csv' ? 'csv' : 'xlsx',
    sheets: [],
  }
  if (metadata.format === 'csv')
    return { metadata, bytes }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
  } catch {
    throw new Error(
      'Не удалось прочитать XLSX. Файл повреждён, защищён паролем или имеет другой формат.',
    )
  }
  context?.check()
  metadata.sheets = workbook.worksheets.map((sheet) => sheet.name)
  if (!metadata.sheets.length)
    throw new Error('В XLSX нет листов.')

  return { metadata, bytes, workbook }
}

function csvRows(bytes: Buffer, options: ImportOptions): SourceRow[] {
  let text: string
  try {
    text = new TextDecoder(options.encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Не удалось декодировать CSV. Выберите другую кодировку.')
  }
  if (text.includes('\0'))
    throw new Error(
      'CSV содержит нулевые байты. Проверьте кодировку и формат файла.',
    )

  let previousEnd = 0
  let cells = 0
  let count = 0
  const rows: SourceRow[] = []
  try {
    // Keeping blank records lets us retain exact physical row numbers.
    parse(text, {
      bom: true,
      delimiter: options.delimiter,
      raw: true,
      relax_column_count: true,
      max_record_size: 1_000_000,
      on_record: (record) => {
        // csv-parse wraps records when raw=true; its default overload omits that wrapper.
        const entry = record as unknown as CsvRecord
        const row = { number: previousEnd + 1, values: entry.record }
        previousEnd += (entry.raw.match(/\r\n|\r|\n/g) ?? []).length
        count += 1
        cells += entry.record.length
        if (
          count > MAX_ROWS ||
          entry.record.length > MAX_COLUMNS ||
          cells > MAX_CELLS
        )
          throw new Error(
            'Превышен лимит: 500 000 строк, 256 колонок или 4 000 000 ячеек.',
          )

        rows.push(row)
        return null
      },
    })
    return rows
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'неизвестная ошибка'
    throw new Error(`Не удалось разобрать CSV: ${detail}`)
  }
}

function cellText(cell: Cell, warnings: Set<string>): string {
  const value = cell.value
  if (value === null || value === undefined)
    return ''

  if (
    typeof value === 'object' &&
    ('formula' in value || 'sharedFormula' in value)
  ) {
    warnings.add(
      'Формулы XLSX не вычисляются: используются сохранённые результаты. При необходимости пересчитайте и сохраните файл в Excel.',
    )
    if (cell.result === undefined)
      return '#NO_CACHED_RESULT'

    return String(cell.result)
  }
  // Preserve common SKU display format, while keeping prices as plain numbers.
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    /^0+$/.test(cell.numFmt)
  )
    return String(value).padStart(Math.min(cell.numFmt.length, 64), '0')

  if (value instanceof Date)
    return value.toISOString()

  return cell.text
}

function xlsxRows(
  source: LoadedSource,
  options: ImportOptions,
  warnings: Set<string>,
  context?: TaskContext,
): SourceRow[] {
  const sheet = source.workbook?.getWorksheet(options.sheet)
  if (!sheet)
    throw new Error('Выбранный лист не найден.')

  if (
    sheet.rowCount > MAX_ROWS ||
    sheet.columnCount > MAX_COLUMNS ||
    sheet.rowCount * sheet.columnCount > MAX_CELLS
  )
    throw new Error(
      'Превышен лимит: 500 000 строк, 256 колонок или 4 000 000 ячеек.',
    )

  const rows: SourceRow[] = []
  sheet.eachRow((row, number) => {
    if (number % 500 === 0) {
      context?.check()
      context?.progress('Чтение строк XLSX', number, sheet.rowCount)
    }
    const values = Array.from({ length: row.cellCount }, (_, index) =>
      cellText(row.getCell(index + 1), warnings),
    )
    rows.push({ number, values })
  })
  return rows
}

export function importSource(
  source: LoadedSource,
  options: ImportOptions,
  context?: TaskContext,
): ImportedTable {
  const warnings = new Set<string>()
  const records =
    source.metadata.format === 'csv'
      ? csvRows(source.bytes, options)
      : xlsxRows(source, options, warnings, context)
  return buildTable(records, source.metadata, options, warnings, context)
}

export function buildTable(
  records: SourceRow[],
  metadata: SourceFile,
  options: ImportOptions,
  warnings = new Set<string>(),
  context?: TaskContext,
): ImportedTable {
  context?.check()
  if (!records.some((row) => row.values.some((value) => value.trim() !== '')))
    throw new Error('Таблица пуста. Выберите другой файл или лист.')

  const headerIndex = records.findIndex(
    (row) => row.number === options.headerRow,
  )
  const header = records[headerIndex]
  if (!header || !header.values.some((value) => value.trim() !== ''))
    throw new Error(
      'Строка заголовков пуста или не найдена. Для CSV укажите начало записи, а не строку внутри многострочного поля.',
    )

  const data = records
    .slice(headerIndex + 1)
    .filter((row) => row.values.some((value) => value.trim() !== ''))
  const width = data.reduce(
    (maximum, row) => Math.max(maximum, row.values.length),
    header.values.length,
  )
  if (data.length * width > MAX_CELLS)
    throw new Error(
      'После выравнивания колонок таблица превышает 4 000 000 ячеек.',
    )

  const columns = Array.from(
    { length: width },
    (_, index) => header.values[index]?.trim() || `Колонка ${index + 1}`,
  )
  if (header.values.filter((value) => value.trim()).length < width)
    warnings.add(
      'Пустым заголовкам назначены имена «Колонка N». Проверьте строку заголовков и разделитель.',
    )

  if (columns.some((column) => column.length > 1000))
    throw new Error('Заголовок колонки длиннее 1000 символов.')

  if (new Set(columns).size !== columns.length)
    warnings.add(
      'Есть повторяющиеся заголовки. Колонки различаются по их номерам.',
    )

  if (data.some((row) => row.values.length !== header.values.length))
    warnings.add(
      'Строки имеют разное число ячеек. Пустые ячейки дополнены; дополнительные колонки сохранены.',
    )

  if (!data.length)
    throw new Error(
      'После строки заголовков нет товаров. Выберите другую строку или лист.',
    )

  return {
    id: randomUUID(),
    name: metadata.name,
    columns,
    rows: data.map((row, position) => {
      if (position % 1000 === 0) {
        context?.check()
        context?.progress('Подготовка таблицы', position, data.length)
      }
      return Array.from(
        { length: width },
        (_, index) => row.values[index] ?? '',
      )
    }),
    rowNumbers: data.map((row) => row.number),
    totalRows: data.length,
    headerRow: options.headerRow,
    warnings: [...warnings],
  }
}

export function preview(table: ImportedTable): ImportedTable {
  return {
    ...table,
    rows: table.rows.slice(0, PREVIEW_ROWS),
    rowNumbers: table.rowNumbers.slice(0, PREVIEW_ROWS),
  }
}
