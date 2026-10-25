import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { productFields } from '../../shared/api.ts'
import type {
  ExportFormat,
  ExportResult,
  ProcessResult,
} from '../../shared/api'
import { toCsv } from './workflow.ts'

export function destinationPath(path: string, format: ExportFormat): string {
  const extension = extname(path)
  if (extension && extension.toLowerCase() !== `.${format}`)
    throw new Error(
      `Выбран формат ${format.toUpperCase()}. Укажите имя файла с расширением .${format}.`,
    )

  return resolve(extension ? path : `${path}.${format}`)
}

export async function toXlsx(result: ProcessResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Прайс-лист', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.columns = productFields.map(({ key, label }) => ({
    key,
    header: label,
    width: key === 'name' ? 55 : 20,
    style: { numFmt: key === 'price' ? '0.00' : '@' },
  }))
  sheet.getRow(1).font = { bold: true }
  sheet.autoFilter = { from: 'A1', to: 'C1' }
  for (const product of result.products) {
    if (product.sku.length > 32767 || product.name.length > 32767)
      throw new Error(
        `Строка ${product.sourceRow}: XLSX допускает не более 32 767 символов в ячейке. Сократите текст или выберите CSV.`,
      )

    // Strings are literal XLSX cells, including text starting with '='.
    sheet.addRow([product.sku, product.name, product.price])
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export function writeErrorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined
  switch (code) {
    case 'EBUSY':
    case 'ETXTBSY':
      return 'Файл занят другой программой. Закройте его или выберите другое имя и повторите сохранение.'
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'Нет доступа для сохранения файла. Закройте его в других программах, проверьте права или выберите другую папку.'
    case 'ENOSPC':
    case 'EDQUOT':
      return 'Недостаточно места на диске. Освободите место или выберите другой диск.'
    case 'ENOENT':
    case 'ENOTDIR':
      return 'Папка для сохранения не найдена. Выберите существующую папку.'
    case 'EISDIR':
    case 'ENOTEMPTY':
      return 'Вместо файла выбрана папка. Укажите другое имя файла.'
    default:
      return 'Не удалось записать файл. Проверьте доступность диска и повторите сохранение в другой папке.'
  }
}

// Write beside the destination, then replace it only after the complete file is closed.
export async function saveFile(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  const temporary = join(dirname(path), `.price-list-${randomUUID()}.tmp`)
  let created = false
  try {
    const file = await fs.open(temporary, 'wx')
    created = true
    try {
      await file.writeFile(data)
    } finally {
      await file.close()
    }
    await fs.rename(temporary, path)
  } catch (error) {
    throw new Error(writeErrorMessage(error))
  } finally {
    if (created) {
      await fs.unlink(temporary).catch(() => undefined)
    }
  }
}

export async function savePriceList(
  path: string,
  format: ExportFormat,
  result: ProcessResult,
): Promise<ExportResult> {
  const destination = destinationPath(path, format)
  const data = format === 'xlsx' ? await toXlsx(result) : toCsv(result)
  await saveFile(destination, data)
  return { canceled: false, path: destination, count: result.products.length }
}
