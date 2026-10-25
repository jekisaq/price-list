import { BrowserWindow, dialog, ipcMain } from 'electron'
import { channels } from '../shared/api'
import type {
  ImportedTable,
  ProcessResult,
  Result,
  ImportOptions,
} from '../shared/api'
import {
  identifier,
  importOptions,
  object,
  processRequest,
  settings,
  currentResult,
  productExport,
  exportFormat,
} from './validation'
import { demoTable, processTable, toReportCsv } from './services/workflow'
import { importSource, loadSource, preview } from './services/import-file'
import {
  destinationPath,
  saveFile,
  savePriceList,
} from './services/export-file'
import type { LoadedSource } from './services/import-file'
import type { ProfileStore } from './services/profile-store'
import { validateMapping } from '../shared/mapping'

export function registerIpc(
  window: BrowserWindow,
  rendererUrl: string,
  profiles: ProfileStore,
): void {
  let imported: ImportedTable | undefined
  let source: LoadedSource | undefined
  let opening = false
  let processed: ProcessResult | undefined
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

      const next = await loadSource(selection.filePaths[0])
      source = next
      imported = undefined
      processed = undefined
      return source.metadata
    } finally {
      opening = false
    }
  })

  handle(channels.import, (input) => {
    if (opening)
      throw new Error('Дождитесь открытия файла.')

    const data = object(input)
    if (data.source !== 'demo' && data.source !== 'file')
      throw new Error('Неизвестный источник таблицы.')

    imported = undefined
    processed = undefined
    if (data.source === 'demo') {
      imported = demoTable()
      importedFormat = 'csv'
      importedOptions = {
        delimiter: ',',
        encoding: 'utf-8',
        sheet: '',
        headerRow: 1,
      }
    } else {
      const id = identifier(data.sourceId)
      if (!source || source.metadata.id !== id)
        throw new Error('Файл устарел. Выберите файл снова.')

      const options = importOptions(data.options)
      imported = importSource(source, options)
      importedOptions = options
      importedFormat = source.metadata.format
    }
    return preview(imported)
  })

  handle(channels.process, (input) => {
    if (!imported)
      throw new Error('Сначала загрузите таблицу.')

    const request = processRequest(input, imported.columns.length)

    if (request.importId !== imported.id)
      throw new Error('Таблица устарела. Повторите загрузку.')

    processed = undefined
    processed = processTable(imported, request)
    return processed
  })

  handle(channels.export, async (input) => {
    const format = exportFormat(input)
    const snapshot = productExport(input, processed)
    const selection = await dialog.showSaveDialog(window, {
      title: 'Экспорт прайс-листа',
      defaultPath: `price-list.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    })
    if (selection.canceled || !selection.filePath)
      return { canceled: true }

    return savePriceList(selection.filePath, format, snapshot)
  })

  handle(channels.exportReport, async (input) => {
    const snapshot = currentResult(input, processed)
    const selection = await dialog.showSaveDialog(window, {
      title: 'Экспорт отчёта об ошибках',
      defaultPath: 'price-list-report.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (selection.canceled || !selection.filePath)
      return { canceled: true }

    const path = destinationPath(selection.filePath, 'csv')
    await saveFile(path, toReportCsv(snapshot))
    return { canceled: false, path, count: snapshot.issues.length }
  })

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

  window.on('closed', () =>
    handlers.forEach((channel) => ipcMain.removeHandler(channel)),
  )
}
