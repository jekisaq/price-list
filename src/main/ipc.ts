import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { channels } from '../shared/api'
import type {
  ImportedTable,
  ProcessResult,
  Result,
  Settings,
} from '../shared/api'
import { identifier, object, processRequest, settings } from './validation'
import { demoTable, processTable, toCsv } from './services/workflow'

export function registerIpc(window: BrowserWindow, rendererUrl: string): void {
  let imported: ImportedTable | undefined
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

  handle(channels.import, (input) => {
    if (object(input).source !== 'demo')
      throw new Error('Чтение файлов будет доступно на следующем этапе.')

    imported = demoTable()
    processed = undefined
    return imported
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
      title: 'Экспорт демонстрационного прайса',
      defaultPath: 'price-list-demo.csv',
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
