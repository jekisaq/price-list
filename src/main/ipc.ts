import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { channels } from '../shared/api'
import type {
  ImportedTable,
  ProcessResult,
  Result,
  Settings,
} from '../shared/api'
import {
  identifier,
  importOptions,
  object,
  processRequest,
  settings,
} from './validation'
import { demoTable, processTable, toCsv } from './services/workflow'
import { importSource, loadSource, preview } from './services/import-file'
import type { LoadedSource } from './services/import-file'

export function registerIpc(window: BrowserWindow, rendererUrl: string): void {
  let imported: ImportedTable | undefined
  let source: LoadedSource | undefined
  let opening = false
  let processed: ProcessResult | undefined
  let sessionSettings: Settings = { markup: 20 }
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
    } else {
      const id = identifier(data.sourceId)
      if (!source || source.metadata.id !== id)
        throw new Error('Файл устарел. Выберите файл снова.')

      imported = importSource(source, importOptions(data.options))
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
    const id = identifier(object(input).resultId)
    if (!processed || id !== processed.id)
      throw new Error('Сначала выполните проверку таблицы.')

    if (processed.errors.length || !processed.products.length)
      throw new Error('Исправьте ошибки перед экспортом.')

    const snapshot = processed
    const selection = await dialog.showSaveDialog(window, {
      title: 'Экспорт прайс-листа',
      defaultPath: 'price-list.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (selection.canceled || !selection.filePath)
      return { canceled: true }

    await writeFile(selection.filePath, toCsv(snapshot), 'utf8')
    return { canceled: false, path: selection.filePath }
  })

  handle(channels.getSettings, (input) => {
    if (input !== undefined)
      throw new Error('Этот запрос не принимает аргументов.')

    return sessionSettings
  })

  handle(channels.saveSettings, (input) => {
    sessionSettings = settings(input)
    return sessionSettings
  })

  window.on('closed', () =>
    handlers.forEach((channel) => ipcMain.removeHandler(channel)),
  )
}
