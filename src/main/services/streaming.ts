import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse'
import ExcelJS from 'exceljs'
import { productFields } from '../../shared/api.ts'
import type {
  ExportFormat,
  ExportResult,
  ImportOptions,
  ProcessResult,
  SourceFile,
} from '../../shared/api'
import {
  buildTable,
  loadSource,
  MAX_BYTES,
  MAX_CELLS,
  MAX_COLUMNS,
  MAX_ROWS,
} from './import-file.ts'
import type { LoadedSource, SourceRow } from './import-file'
import { serializeCsv } from './workflow.ts'
import { OperationCanceled } from './task-context.ts'
import type { TaskContext } from './task-context'
import { writeErrorMessage } from './export-file.ts'

export interface RuntimeSource {
  metadata: SourceFile
  path: string
  loaded?: LoadedSource
}

export async function openRuntimeSource(
  path: string,
  context: TaskContext,
): Promise<RuntimeSource> {
  context.progress('Чтение файла', 0)
  const extension = extname(path).toLowerCase()
  if (extension !== '.csv' && extension !== '.xlsx')
    throw new Error('Поддерживаются только файлы CSV и XLSX.')

  const stat = await fs.stat(path)
  if (!stat.isFile() || stat.size === 0)
    throw new Error('Файл пуст или не является обычным файлом.')

  if (stat.size > MAX_BYTES)
    throw new Error('Файл больше 100 МиБ. Разделите его на несколько файлов.')

  context.check()
  if (extension === '.xlsx') {
    const loaded = await loadSource(path, context)
    return { path, loaded, metadata: loaded.metadata }
  }
  return {
    path,
    metadata: {
      id: randomUUID(),
      name: basename(path),
      format: 'csv',
      sheets: [],
    },
  }
}

export async function importCsvFile(
  source: RuntimeSource,
  options: ImportOptions,
  context: TaskContext,
) {
  const stat = await fs.stat(source.path)
  if (stat.size > MAX_BYTES)
    throw new Error('Файл больше 100 МиБ.')

  const input = createReadStream(source.path, { highWaterMark: 64 * 1024 })
  const decoder = new TextDecoder(options.encoding, { fatal: true })
  let bytes = 0
  const decode = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        context.check()
        bytes += chunk.length
        if (bytes > MAX_BYTES)
          throw new Error('Файл больше 100 МиБ.')

        const text = decoder.decode(chunk, { stream: true })
        if (text.includes('\0'))
          throw new Error(
            'CSV содержит нулевые байты. Проверьте кодировку и формат файла.',
          )

        callback(null, text)
      } catch (error) {
        callback(
          error instanceof TypeError
            ? new Error(
                'Не удалось декодировать CSV. Выберите другую кодировку.',
              )
            : error instanceof Error
              ? error
              : new Error(String(error)),
        )
      }
    },
    flush(callback) {
      try {
        callback(null, decoder.decode())
      } catch {
        callback(
          new Error('Не удалось декодировать CSV. Выберите другую кодировку.'),
        )
      }
    },
  })
  const parser = parse({
    bom: true,
    delimiter: options.delimiter,
    raw: true,
    relax_column_count: true,
    max_record_size: 1_000_000,
  })
  const completion = pipeline(input, decode, parser)
  // Consume the pipeline rejection even if iteration fails first.
  completion.catch(() => undefined)
  const rows: SourceRow[] = []
  let previousEnd = 0
  let cells = 0
  try {
    for await (const entry of parser) {
      context.check()
      const record = entry as { record: string[]; raw: string }
      rows.push({ number: previousEnd + 1, values: record.record })
      previousEnd += (record.raw.match(/\r\n|\r|\n/g) ?? []).length
      cells += record.record.length
      if (
        rows.length > MAX_ROWS ||
        record.record.length > MAX_COLUMNS ||
        cells > MAX_CELLS
      )
        throw new Error(
          'Превышен лимит: 500 000 строк, 256 колонок или 4 000 000 ячеек.',
        )

      if (rows.length % 1000 === 0)
        context.progress(
          'Чтение CSV',
          rows.length,
          undefined,
          Math.min(99, Math.floor((bytes / stat.size) * 100)),
        )

    }
    await completion
    context.check()
    return buildTable(rows, source.metadata, options, new Set(), context)
  } catch (error) {
    if (error instanceof OperationCanceled)
      throw error

    throw new Error(
      `Не удалось прочитать CSV: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
    )
  } finally {
    input.destroy()
    decode.destroy()
    parser.destroy()
  }
}

export async function streamExport(
  path: string,
  temporary: string,
  result: ProcessResult,
  format: ExportFormat,
  report: boolean,
  context: TaskContext,
): Promise<ExportResult> {
  const count = report ? result.issues.length : result.products.length
  let created = false
  let file: Awaited<ReturnType<typeof fs.open>> | undefined
  let output:
    | ReturnType<Awaited<ReturnType<typeof fs.open>>['createWriteStream']>
    | undefined
  const excluded = new Set(result.excludedRows)
  try {
    file = await fs.open(temporary, 'wx')
    created = true
    if (format === 'xlsx' && !report) {
      output = file.createWriteStream({ autoClose: false })
      let streamError: Error | undefined
      output.on('error', (error) => {
        streamError = error
      })
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: output,
        useStyles: true,
        useSharedStrings: false,
      })
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
      sheet.autoFilter = 'A1:C1'
      for (let index = 0; index < count; index++) {
        context.check()
        const product = result.products[index]!
        if (product.sku.length > 32767 || product.name.length > 32767)
          throw new Error(
            `Строка ${product.sourceRow}: XLSX допускает не более 32 767 символов в ячейке. Сократите текст или выберите CSV.`,
          )

        sheet.addRow([product.sku, product.name, product.price]).commit()
        if (index % 500 === 0) {
          context.progress('Запись XLSX', index, count)
          await new Promise<void>((done) => setImmediate(done))
          if (streamError)
            throw streamError

        }
      }
      context.progress('Упаковка XLSX', count, count, 99)
      await workbook.commit()
      output.destroy()
    } else {
      const header = report
        ? [
            'Файл',
            'Строка',
            'Номер колонки',
            'Колонка',
            'Поле',
            'Значение',
            'Уровень',
            'Причина',
            'Исключена',
          ]
        : productFields.map((field) => field.label)
      await file.writeFile(serializeCsv([header]))
      for (let offset = 0; offset < count; offset += 500) {
        context.check()
        const rows = report
          ? result.issues
              .slice(offset, offset + 500)
              .map((issue) => [
                result.sourceName,
                issue.sourceRow === null ? '' : String(issue.sourceRow),
                issue.columnIndex === null ? '' : String(issue.columnIndex + 1),
                issue.columnName,
                productFields.find((field) => field.key === issue.field)
                  ?.label ?? '',
                issue.value,
                issue.severity === 'error' ? 'Ошибка' : 'Предупреждение',
                issue.message,
                issue.sourceRow !== null && excluded.has(issue.sourceRow)
                  ? 'Да'
                  : 'Нет',
              ])
          : result.products
              .slice(offset, offset + 500)
              .map((product) => [
                product.sku,
                product.name,
                product.price.toFixed(2),
              ])
        await file.writeFile('\r\n' + serializeCsv(rows).slice(1))
        context.progress(
          report ? 'Запись отчёта CSV' : 'Запись CSV',
          Math.min(count, offset + 500),
          count,
        )
      }
    }
    await file.close()
    file = undefined
    context.check()
    context.commit()
    await fs.rename(temporary, path)
    return { canceled: false, path, count }
  } catch (error) {
    if (error instanceof OperationCanceled)
      throw error

    if (error && typeof error === 'object' && 'code' in error)
      throw new Error(writeErrorMessage(error))

    throw error
  } finally {
    output?.destroy()
    await file?.close().catch(() => undefined)
    if (created)
      await fs.unlink(temporary).catch(() => undefined)

  }
}
