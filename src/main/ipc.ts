import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { WorkerClient } from './worker-client'
import { OperationCanceled } from './services/task-context'
import { channels } from '../shared/api'
import type {
  ImportedTable,
  ProcessView,
  ReportPage,
  SourceFile,
  Result,
  ImportOptions,
} from '../shared/api'
import {
  identifier,
  importOptions,
  object,
  processRequest,
  settings,
  exportFormat,
} from './validation'
import { destinationPath } from './services/export-file'
import type { ProfileStore } from './services/profile-store'
import { validateMapping } from '../shared/mapping'

export function registerIpc(
  window: BrowserWindow,
  rendererUrl: string,
  profiles: ProfileStore,
): void {
  let imported: ImportedTable | undefined
  let source: SourceFile | undefined
  let opening = false
  let processed: ProcessView | undefined
  const createClient = () =>
    new WorkerClient(undefined, (progress) => {
      if (progress.invalidated) {
        imported = undefined
        processed = undefined
        source = undefined
      }
      if (!window.webContents.isDestroyed())
        window.webContents.send(channels.operation, progress)

    })
  let client = createClient()
  let importedOptions: ImportOptions = {
    delimiter: ',',
    encoding: 'utf-8',
    sheet: '',
    headerRow: 1,
  }
  let importedFormat: 'csv' | 'xlsx' = 'csv'
  const handlers: string[] = []

  function handle<T>(
    channel: string,
    action: (input: unknown) => T | Promise<T>,
  ) {
    handlers.push(channel)
    ipcMain.handle(
      channel,
      async (event, ...args: unknown[]): Promise<Result<T>> => {
        try {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame?.url !== rendererUrl
          )
            throw new Error('Запрос из неизвестного окна отклонён.')

          if (args.length > 1)
            throw new Error('Некорректное количество аргументов.')

          return { ok: true, value: await action(args[0]) }
        } catch (error) {
          return {
            ok: false,
            canceled: error instanceof OperationCanceled,
            error:
              error instanceof Error
                ? error.message
                : 'Не удалось выполнить операцию.',
          }
        }
      },
    )
  }

  handle(channels.openFile, async (input) => {
    if (input !== undefined)
      throw new Error('Этот запрос не принимает аргументов.')

    if (opening)
      throw new Error('Дождитесь открытия файла.')

    opening = true
    try {
      const selection = await dialog.showOpenDialog(window, {
        title: 'Выберите таблицу поставщика',
        properties: ['openFile'],
        filters: [{ name: 'Таблицы поставщиков', extensions: ['csv', 'xlsx'] }],
      })
      if (selection.canceled || !selection.filePaths[0])
        return null

      const next = await client.request<SourceFile>(
        'open',
        { path: selection.filePaths[0] },
        'open',
      )
      source = next
      imported = undefined
      processed = undefined
      return source
    } finally {
      opening = false
    }
  })

  handle(channels.import, async (input) => {
    if (opening)
      throw new Error('Дождитесь открытия файла.')

    const data = object(input)
    if (data.source !== 'demo' && data.source !== 'file')
      throw new Error('Неизвестный источник таблицы.')

    let options: ImportOptions = {
      delimiter: ',',
      encoding: 'utf-8',
      sheet: '',
      headerRow: 1,
    }
    if (data.source === 'file') {
      if (!source || source.id !== identifier(data.sourceId))
        throw new Error('Файл устарел. Выберите файл снова.')

      options = importOptions(data.options)
    }
    imported = undefined
    processed = undefined
    const next = await client.request<ImportedTable>('import', input, 'import')
    imported = next
    importedOptions = options
    importedFormat = data.source === 'demo' ? 'csv' : source!.format
    return next
  })
  handle(channels.process, async (input) => {
    if (!imported)
      throw new Error('Сначала загрузите таблицу.')

    const request = processRequest(input, imported.columns.length)
    if (request.importId !== imported.id)
      throw new Error('Таблица устарела. Повторите загрузку.')

    processed = undefined
    processed = await client.request<ProcessView>('process', request, 'process')
    return processed
  })
  handle(channels.importPage, (input) =>
    client.request<ImportedTable>('importPage', pageRequest(input)),
  )
  handle(channels.reportPage, (input) => {
    const data = object(input)
    if (
      data.filter !== 'all' &&
      data.filter !== 'errors' &&
      data.filter !== 'duplicates' &&
      data.filter !== 'warnings' &&
      data.filter !== 'excluded' &&
      data.filter !== 'ready'
    )
      throw new Error('Некорректный фильтр отчёта.')

    return client.request<ReportPage>('reportPage', {
      ...pageRequest(data),
      filter: data.filter,
    })
  })
  handle(channels.cancelOperation, (input) =>
    client.cancel(identifier(object(input).id)),
  )
  async function exportResult(input: unknown, report: boolean) {
    const data = object(input)
    const format = report ? 'csv' : exportFormat(data)
    await client.request<ProcessView>('checkExport', { ...data, report })
    const selection = await dialog.showSaveDialog(window, {
      title: report ? 'Экспорт отчёта об ошибках' : 'Экспорт прайс-листа',
      defaultPath: report ? 'price-list-report.csv' : `price-list.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    })
    if (selection.canceled || !selection.filePath)
      return { canceled: true } as const

    const path = destinationPath(selection.filePath, format)
    const temporary = join(dirname(path), `.price-list-${randomUUID()}.tmp`)
    return client.request(
      'export',
      { ...data, report, path, temporary },
      'export',
    )
  }
  handle(channels.export, (input) => exportResult(input, false))
  handle(channels.exportReport, (input) => exportResult(input, true))

  handle(channels.getSettings, async (input) => {
    if (input !== undefined)
      throw new Error('Этот запрос не принимает аргументов.')

    return (await profiles.getState()).settings
  })

  handle(channels.saveSettings, (input) => {
    return profiles.saveSettings(input)
  })

  handle(channels.getProfiles, (input) => {
    if (input !== undefined)
      throw new Error('Этот запрос не принимает аргументов.')

    return profiles.getState()
  })
  handle(channels.saveProfile, (input) => {
    const data = object(input)
    if (!imported || identifier(data.importId) !== imported.id)
      throw new Error('Сначала загрузите актуальную таблицу для профиля.')

    const mapping = validateMapping(data.mapping, imported.columns.length)
    if (!mapping.valid)
      throw new Error(Object.values(mapping.errors).join(' '))

    return profiles.saveProfile({
      id: data.profileId,
      name: data.name,
      settings: settings(data.settings),
      format: importedFormat,
      importOptions: importedOptions,
      columns: imported.columns,
      mapping: mapping.mapping,
    })
  })
  handle(channels.selectProfile, async (input) => {
    const state = await profiles.selectProfile(object(input).profileId)
    imported = undefined
    processed = undefined
    source = undefined
    await client.dispose()
    client = createClient()
    return state
  })
  handle(channels.renameProfile, (input) => {
    const data = object(input)
    return profiles.renameProfile(data.profileId, data.name)
  })
  handle(channels.deleteProfile, async (input) => {
    const state = await profiles.deleteProfile(object(input).profileId)
    imported = undefined
    processed = undefined
    source = undefined
    return state
  })

  window.on('close', (event) => {
    event.preventDefault()
    void client.dispose().finally(() => {
      if (!window.isDestroyed())
        window.destroy()

    })
  })
  window.on('closed', () =>
    handlers.forEach((channel) => ipcMain.removeHandler(channel)),
  )
}

function pageRequest(value: unknown) {
  const data = object(value)
  const id = identifier(data.id)
  if (
    typeof data.offset !== 'number' ||
    !Number.isSafeInteger(data.offset) ||
    data.offset < 0 ||
    data.offset > 500_000 ||
    typeof data.limit !== 'number' ||
    !Number.isInteger(data.limit) ||
    data.limit < 1 ||
    data.limit > 200
  )
    throw new Error('Некорректные параметры страницы.')

  return { id, offset: data.offset, limit: data.limit }
}
