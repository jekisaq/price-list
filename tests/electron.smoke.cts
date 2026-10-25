import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ExcelJS from 'exceljs'

const timeout = setTimeout(() => {
  console.error('Smoke test timeout')
  app.exit(1)
}, 30000)
const loaded = new Promise<BrowserWindow>((resolveWindow) => {
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => resolveWindow(window))
  })
})

async function smoke() {
  await import(pathToFileURL(resolve('out/main/main.js')).href)
  const window = await loaded
  const evaluate = (script: string) =>
    window.webContents.executeJavaScript(script) as Promise<unknown>

  async function click(text: string) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const clicked = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)});
        if (!button || button.disabled)
          return false;
        button.click();
        return true;
      })()`)

      if (clicked)
        return

      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
    throw new Error(`Button unavailable: ${text}`)
  }
  async function waitText(text: string) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (
        await evaluate(
          `document.body.innerText.includes(${JSON.stringify(text)})`,
        )
      )
        return

      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }

    throw new Error(`Missing text: ${text}`)
  }

  async function changeField(label: string, value: string) {
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(item => item.textContent === ${JSON.stringify(label)});
      const field = label && document.getElementById(label.htmlFor);
      if (!field)
        throw new Error('Field not found');

      const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  assert.equal(await evaluate('typeof window.require'), 'undefined')
  assert.equal(
    await evaluate(
      '(async () => (await window.api.saveSettings({markup: -1})).ok)()',
    ),
    false,
  )
  assert.equal(
    await evaluate(
      '(async () => (await window.api.importTable({source: "file"})).ok)()',
    ),
    false,
  )
  await click('Загрузить демонстрационную таблицу')
  await click('Проверить и рассчитать')
  await waitText('144.00')
  await click('Перейти к экспорту')
  dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  await click('Сохранить CSV…')
  await waitText('Сохранение отменено.')
  const exportPath = resolve('out/tests/smoke-export.csv')
  dialog.showSaveDialog = async () => ({
    canceled: false,
    filePath: exportPath,
  })
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  assert.ok(
    (await readFile(exportPath, 'utf8')).includes('"001";"Блокнот";"144.00"'),
  )
  await writeFile(
    resolve('out/tests/workflow.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  await click('Новый импорт')
  await waitText('Загрузить демонстрационную таблицу')

  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  await click('Выбрать CSV / XLSX…')
  await waitText('Выбор файла отменён.')

  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [resolve('samples/csv/supplier-basic.csv')],
  })
  await click('Выбрать CSV / XLSX…')
  await waitText('Файл: supplier-basic.csv')
  await click('Показать предпросмотр')
  await waitText('Строк товаров: 10')
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await waitText('Готово товаров: 10')
  await click('Перейти к экспорту')
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  assert.equal((await readFile(exportPath, 'utf8')).split('\r\n').length, 11)
  await click('Новый импорт')

  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [resolve('samples/csv/supplier-semicolon.csv')],
  })
  await click('Выбрать CSV / XLSX…')
  await waitText('Файл: supplier-semicolon.csv')
  await changeField('Разделитель CSV', ';')
  await click('Показать предпросмотр')
  await waitText('Строк товаров: 8')
  await changeField('Строка заголовков', '0')
  assert.equal(
    await evaluate(
      `Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Перейти к сопоставлению'))`,
    ),
    false,
  )
  await changeField('Строка заголовков', '1')
  await click('Показать предпросмотр')
  await waitText('Строк товаров: 8')

  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Пустой')
  const sheet = workbook.addWorksheet('Товары')
  sheet.addRow(['Поставщик'])
  sheet.addRow(['Артикул', 'Название', 'Цена'])
  sheet.addRow(['00042', 'Тестовый товар', 10])
  const xlsxPath = resolve('out/tests/supplier.xlsx')
  await workbook.xlsx.writeFile(xlsxPath)
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [xlsxPath],
  })
  await click('Выбрать CSV / XLSX…')
  await waitText('Файл: supplier.xlsx')
  await click('Показать предпросмотр')
  await waitText('Таблица пуста.')
  await changeField('Лист XLSX', 'Товары')
  await changeField('Строка заголовков', '2')
  await click('Показать предпросмотр')
  await waitText('00042')
  await writeFile(
    resolve('out/tests/import-preview.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await waitText('12.00')
  await click('Перейти к экспорту')
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  assert.ok(
    (await readFile(exportPath, 'utf8')).includes(
      '"00042";"Тестовый товар";"12.00"',
    ),
  )

  console.log(
    'PASS: isolation, validation, demo, CSV/XLSX imports, options, preview invalidation, cancellation and export',
  )
}

smoke()
  .then(() => {
    clearTimeout(timeout)
    app.exit(0)
  })
  .catch((error: unknown) => {
    console.error(error)
    clearTimeout(timeout)
    app.exit(1)
  })
