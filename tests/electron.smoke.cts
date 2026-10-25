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
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', () => resolveWindow(window))
  })
})

async function smoke() {
  await import(pathToFileURL(resolve('out/main/main.js')).href)
  const window = await loaded
  const evaluate = (script: string) =>
    window.webContents.executeJavaScript(script) as Promise<unknown>

  async function capture(name: string) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const image = await window.webContents.capturePage()
        await writeFile(resolve('out/tests', name), image.toPNG())
        return
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes('UnknownVizError') ||
          attempt === 2
        )
          throw error

        await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      }
    }
  }

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
      const label = [...document.querySelectorAll('label')].find(item => item.textContent.replaceAll('*', '').trim() === ${JSON.stringify(label)});
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
  await capture('workflow.png')
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
  await capture('import-preview.png')
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

  await click('Новый импорт')
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [resolve('samples/csv/supplier-reordered.csv')],
  })
  await click('Выбрать CSV / XLSX…')
  await waitText('Файл: supplier-reordered.csv')
  await click('Показать предпросмотр')
  await waitText('Строк товаров: 6')
  await click('Перейти к сопоставлению')
  assert.deepEqual(
    await evaluate(
      `['sku', 'name', 'price'].map(key => document.getElementById('mapping-' + key).value)`,
    ),
    ['4', '2', '1'],
  )
  await changeField('Артикул', '4')
  await changeField('Наименование', '2')
  await changeField('Цена', '1')
  const mappedText = () =>
    evaluate(
      `document.querySelector('table[aria-label="Предпросмотр сопоставления"]').innerText`,
    )
  assert.ok(String(await mappedText()).includes('ST-0001'))
  await waitText('Пропускаемые колонки (2)')
  await changeField('Цена', '')
  assert.equal(
    await evaluate(`document.querySelector('#mapping-price').value`),
    '',
  )
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('button')].find(button => button.textContent === 'Проверить и рассчитать').disabled`,
    ),
    true,
  )
  await changeField('Цена', '4')
  await waitText('Эта колонка уже выбрана для другого поля.')
  await changeField('Цена', '0')
  assert.ok(String(await mappedText()).includes('Канцтовары'))
  await changeField('Цена', '1')
  await evaluate(
    `document.querySelector('table[aria-label="Предпросмотр сопоставления"]').scrollIntoView({block: 'center'})`,
  )
  await capture('mapping-preview.png')
  await click('Проверить и рассчитать')
  await waitText('Готово товаров: 6')
  await click('Изменить сопоставление')
  assert.equal(
    await evaluate(`document.getElementById('mapping-sku').value`),
    '4',
  )
  await click('Проверить и рассчитать')
  await click('Перейти к экспорту')
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  const reorderedCsv = await readFile(exportPath, 'utf8')
  assert.ok(reorderedCsv.includes('"ST-0001";"Блокнот А5";"144.00"'))
  assert.ok(!reorderedCsv.includes('Канцтовары'))

  await click('Новый импорт')
  const unknownPath = resolve('out/tests/unknown-headers.csv')
  await writeFile(
    unknownPath,
    'Идентификатор,Текст,Тариф,Склад\n000001,Ручка,35,100',
  )
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [unknownPath],
  })
  await click('Выбрать CSV / XLSX…')
  await waitText('Файл: unknown-headers.csv')
  await click('Показать предпросмотр')
  await waitText('Строк товаров: 1')
  await click('Перейти к сопоставлению')
  assert.deepEqual(
    await evaluate(
      `['sku', 'name', 'price'].map(key => document.getElementById('mapping-' + key).value)`,
    ),
    ['', '', ''],
  )
  await changeField('Артикул', '0')
  await changeField('Наименование', '1')
  await changeField('Цена', '2')
  assert.ok(String(await mappedText()).includes('000001'))
  await click('Проверить и рассчитать')
  await waitText('42.00')
  await click('Перейти к экспорту')
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  assert.ok(
    (await readFile(exportPath, 'utf8')).includes('"000001";"Ручка";"42.00"'),
  )

  await click('Новый импорт')
  const duplicatesPath = resolve('out/tests/duplicate-prices.csv')
  await writeFile(
    duplicatesPath,
    'Артикул,Наименование,Цена\n001,Первый,"1 234,56"\n001,Второй,"2,05"',
  )
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [duplicatesPath],
  })
  await click('Выбрать CSV / XLSX…')
  await waitText('Файл: duplicate-prices.csv')
  await click('Показать предпросмотр')
  await waitText('Строк товаров: 2')
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await waitText('Повторяющийся артикул 001')
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('button')].find(button => button.textContent === 'Перейти к экспорту').disabled`,
    ),
    true,
  )
  await changeField('Артикул — строка 3', '')
  await click('Пересчитать исправления')
  await waitText('Строка 3: Артикул — обязательное поле.')
  await changeField('Артикул — строка 3', '002')
  await waitText('Предпросмотр устарел')
  await click('Пересчитать исправления')
  await waitText('Готово товаров: 2. Ошибок: 0.')
  await waitText('1234.56')
  await waitText('1481.47')
  await waitText('2.46')
  await evaluate(
    `document.querySelectorAll('table')[document.querySelectorAll('table').length - 1].scrollIntoView({block: 'center'})`,
  )
  await capture('processing-preview.png')
  await click('Перейти к экспорту')
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  assert.ok(
    (await readFile(exportPath, 'utf8')).includes('"002";"Второй";"2.46"'),
  )
  await click('Назад')
  await click('Изменить сопоставление')
  // Changing the mapping resets row corrections before testing duplicate policies.
  await changeField('Артикул', '')
  await changeField('Артикул', '0')
  await changeField('Обработка дублей', 'last')
  await changeField('Округление', 'up')
  await changeField('Шаг округления', '1')
  await click('Проверить и рассчитать')
  await waitText('Исключены повторные строки: 2.')
  await waitText('3.00')
  await click('Изменить сопоставление')
  await changeField('Обработка дублей', 'first')
  await changeField('Округление', 'down')
  await changeField('Шаг округления', '10')
  await click('Проверить и рассчитать')
  await waitText('Исключены повторные строки: 3.')
  await waitText('1480.00')
  await click('Перейти к экспорту')
  await click('Сохранить CSV…')
  await waitText('Файл сохранён:')
  assert.ok(
    (await readFile(exportPath, 'utf8')).includes('"001";"Первый";"1480.00"'),
  )

  console.log(
    'PASS: imports, mapping suggestions, manual mapping, validation, live preview, skipped columns, leading zeros, duplicate corrections, rounding and export',
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
