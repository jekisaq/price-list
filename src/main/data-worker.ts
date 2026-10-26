import { parentPort } from 'node:worker_threads'
import type {
  ImportedTable,
  ProcessResult,
  ProcessView,
  ReportFilter,
  ReportPage,
} from '../shared/api'
import { demoTable, processTable } from './services/workflow.ts'
import { importSource } from './services/import-file.ts'
import {
  importCsvFile,
  openRuntimeSource,
  streamExport,
} from './services/streaming.ts'
import type { RuntimeSource } from './services/streaming'
import {
  currentResult,
  exportFormat,
  identifier,
  importOptions,
  object,
  processRequest,
  productExport,
} from './validation.ts'
import { taskContext, OperationCanceled } from './services/task-context.ts'
import type { TaskContext } from './services/task-context'

let source: RuntimeSource | undefined
let imported: ImportedTable | undefined
let processed: ProcessResult | undefined
let byRow = new Map<number, ProcessResult['issues']>()
let pages = new Map<ReportFilter, ProcessResult['rows']>()
const short = (value: string) =>
  value.length > 1000 ? value.slice(0, 1000) + '…' : value
const viewTable = (
  table: ImportedTable,
  offset = 0,
  limit = 100,
): ImportedTable => ({
  ...table,
  columns: table.columns.map(short),
  rows: table.rows.slice(offset, offset + limit).map((row) => row.map(short)),
  rowNumbers: table.rowNumbers.slice(offset, offset + limit),
})
function clearResult() {
  processed = undefined
  byRow.clear()
  pages.clear()
}
function summary(result: ProcessResult): ProcessView {
  let errors = 0
  for (const issue of result.issues) {
    if (issue.severity === 'error')
      errors++

  }
  return {
    id: result.id,
    sourceName: result.sourceName,
    summary: result.summary,
    productCount: result.products.length,
    errorCount: errors,
    warningCount: result.issues.length - errors,
    importWarnings: result.issues
      .filter((issue) => issue.sourceRow === null)
      .slice(0, 20),
    excludedRows: result.excludedRows.slice(0, 20),
  }
}
function indexReport(result: ProcessResult, context: TaskContext) {
  byRow = new Map()
  const warnings = new Set<number>()
  result.issues.forEach((issue, index) => {
    if (index % 1000 === 0)
      context.check()

    if (issue.sourceRow === null)
      return

    const list = byRow.get(issue.sourceRow) ?? []
    list.push(issue)
    byRow.set(issue.sourceRow, list)
    if (issue.severity === 'warning')
      warnings.add(issue.sourceRow)

  })
  pages = new Map(
    (
      [
        'all',
        'errors',
        'duplicates',
        'warnings',
        'excluded',
        'ready',
      ] as ReportFilter[]
    ).map((filter) => [filter, []]),
  )
  result.rows.forEach((row, index) => {
    if (index % 1000 === 0) {
      context.check()
      context.progress('Подготовка отчёта', index, result.rows.length)
    }
    pages.get('all')!.push(row)
    if (row.hasErrors)
      pages.get('errors')!.push(row)

    if (row.duplicate)
      pages.get('duplicates')!.push(row)

    if (warnings.has(row.sourceRow))
      pages.get('warnings')!.push(row)

    if (row.excluded)
      pages.get('excluded')!.push(row)

    if (!row.hasErrors && !row.excluded)
      pages.get('ready')!.push(row)

  })
}

async function execute(
  command: string,
  input: unknown,
  context: TaskContext,
): Promise<unknown> {
  const data = object(input)
  if (command === 'open') {
    if (typeof data.path !== 'string')
      throw new Error('Некорректный путь.')

    const next = await openRuntimeSource(data.path, context)
    context.check()
    source = next
    imported = undefined
    clearResult()
    return source.metadata
  }
  if (command === 'import') {
    imported = undefined
    clearResult()
    let next: ImportedTable
    if (data.source === 'demo') {
      next = demoTable()
    } else {
      if (!source || source.metadata.id !== identifier(data.sourceId))
        throw new Error('Файл устарел. Выберите файл снова.')

      const options = importOptions(data.options)
      next =
        source.metadata.format === 'csv'
          ? await importCsvFile(source, options, context)
          : importSource(source.loaded!, options, context)
    }
    context.check()
    imported = next
    return viewTable(next)
  }
  if (command === 'process') {
    clearResult()
    if (!imported)
      throw new Error('Сначала загрузите таблицу.')

    const request = processRequest(input, imported.columns.length)
    if (request.importId !== imported.id)
      throw new Error('Таблица устарела. Повторите загрузку.')

    const result = processTable(imported, request, context)
    indexReport(result, context)
    context.check()
    processed = result
    return summary(result)
  }
  if (command === 'importPage') {
    if (!imported || data.id !== imported.id)
      throw new Error('Таблица устарела. Повторите загрузку.')

    return viewTable(imported, data.offset as number, data.limit as number)
  }
  if (command === 'reportPage') {
    if (!processed || data.id !== processed.id)
      throw new Error('Результат устарел. Повторите проверку.')

    const all = pages.get(data.filter as ReportFilter)!
    const rows = all.slice(
      data.offset as number,
      (data.offset as number) + (data.limit as number),
    )
    return {
      rows: rows.map((row) => ({
        ...row,
        sku: short(row.sku),
        name: short(row.name),
        rawPrice: short(row.rawPrice),
      })),
      issues: rows.flatMap((row) =>
        (byRow.get(row.sourceRow) ?? []).map((issue) => ({
          ...issue,
          value: short(issue.value),
          message: short(issue.message),
        })),
      ),
      total: all.length,
      offset: data.offset as number,
    } satisfies ReportPage
  }
  if (command === 'checkExport') {
    return summary(
      data.report
        ? currentResult(input, processed)
        : productExport(input, processed),
    )
  }
  if (command === 'export') {
    const result = data.report
      ? currentResult(input, processed)
      : productExport(input, processed)
    const format = data.report ? 'csv' : exportFormat(input)
    return streamExport(
      data.path as string,
      data.temporary as string,
      result,
      format,
      Boolean(data.report),
      context,
    )
  }
  if (command === 'metrics')
    return {
      heapUsed: process.memoryUsage().heapUsed,
      rss: process.memoryUsage().rss,
    }

  throw new Error('Неизвестная задача.')
}

let queue = Promise.resolve()
parentPort!.on(
  'message',
  (message: {
    id: string
    command: string
    data: unknown
    flag: SharedArrayBuffer
  }) => {
    queue = queue.then(async () => {
      const context = taskContext(new Int32Array(message.flag), (progress) =>
        parentPort!.postMessage({
          id: message.id,
          progress: {
            ...progress,
            workerHeapBytes: process.memoryUsage().heapUsed,
          },
        }),
      )
      try {
        context.check()
        const value = await execute(message.command, message.data, context)
        context.check()
        context.progress('Завершено', 0, undefined, 100)
        parentPort!.postMessage({ id: message.id, value })
      } catch (error) {
        if (message.command === 'import') {
          imported = undefined
          clearResult()
        }
        if (message.command === 'process')
          clearResult()

        parentPort!.postMessage({
          id: message.id,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось выполнить задачу.',
          canceled: error instanceof OperationCanceled,
        })
      }
    })
  },
)
