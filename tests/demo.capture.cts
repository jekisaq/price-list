import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Drives the real UI. Only native file pickers are replaced for repeatability.
const timeout = setTimeout(() => app.exit(1), 60000)
const loaded = new Promise<BrowserWindow>((done) => {
  app.once('browser-window-created', (_event, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', () => done(window))
  })
})

async function captureDemo() {
  const media = resolve('docs/media')
  await mkdir(media, { recursive: true })
  await mkdir(resolve('samples/output'), { recursive: true })
  app.setPath('userData', await mkdtemp(resolve('out/tests/demo-user-data-')))
  await import(pathToFileURL(resolve('out/main/main.js')).href)
  const window = await loaded
  window.setSize(1200, 1000)
  window.webContents.setZoomFactor(0.85)
  const evaluate = (source: string) =>
    window.webContents.executeJavaScript(source) as Promise<unknown>
  const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms))
  async function wait(source: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(source))
        return

      await pause(20)
    }
    throw new Error(`UI condition timed out: ${source}`)
  }
  const text = (value: string) =>
    wait(`document.body.innerText.includes(${JSON.stringify(value)})`)
  async function click(label: string) {
    await wait(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent === ${JSON.stringify(label)});
      if (!button || button.disabled)
        return false;

      button.click(); return true;
    })()`)
  }
  async function capture(name: string, selector = 'section[aria-busy]') {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'})`,
    )
    await pause(40)
    await writeFile(
      resolve(media, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
    )
  }
  async function open(path: string) {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [resolve(path)],
    })
    await click('Выбрать CSV / XLSX…')
    await click('Показать предпросмотр')
  }
  async function change(label: string, value: string) {
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(item => item.textContent.replaceAll('*','').trim() === ${JSON.stringify(label)});
      const field = label && document.getElementById(label.htmlFor);
      if (!field)
        throw new Error('Field not found');

      const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,${JSON.stringify(value)});
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));
    })()`)
    await pause()
  }
  await wait(`Boolean(window.api) && Boolean(document.querySelector('button'))`)
  await evaluate('document.fonts.ready.then(() => true)')
  await pause(300)
  await open('samples/csv/supplier-basic.csv')
  await text('Строк товаров: 10')
  await capture('01-import')
  await click('Перейти к сопоставлению')
  await capture('02-mapping')
  await click('Проверить и рассчитать')
  await text('Готово товаров: 10')
  await text('144.00')
  await capture('03-result')
  await click('Перейти к экспорту')
  for (const format of ['csv', 'xlsx']) {
    await change('Формат экспорта', format)
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: resolve(`samples/output/price-markup-20.${format}`),
    })
    await click(format === 'csv' ? 'Сохранить CSV…' : 'Сохранить XLSX…')
    await text('Сохранено товаров: 10')
  }
  await capture('04-export')
  // Navigate back through the actual workflow and import the invalid fixture.
  await click('Назад')
  await click('Изменить сопоставление')
  await click('Назад')
  await open('samples/csv/supplier-invalid.csv')
  await text('Строк товаров: 9')
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await text('Экспорт прайса заблокирован.')
  await capture('05-errors')
  await click('Изменить сопоставление')
  await click('Назад')
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [resolve('samples/generated/prices-400000.csv')],
  })
  await click('Выбрать CSV / XLSX…')
  // Real progress and cancellation; no injected delays or synthetic operation data.
  await click('Показать предпросмотр')
  await wait(
    `Boolean(document.querySelector('[aria-label="Прогресс операции"]'))`,
  )
  await capture('06-progress', '[aria-label="Прогресс операции"]')
  await click('Отменить операцию')
  await wait(`Boolean(document.querySelector('[role="dialog"]'))`)
  await pause(300)
  await capture('07-cancel-confirmation', '[role="dialog"]')
  await click('Остановить')
  await text('Операция отменена.')
  await capture('08-canceled', '[role="alert"]')
  await open('samples/csv/supplier-basic.csv')
  await text('Строк товаров: 10')
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await text('Готово товаров: 10')
  await capture('09-recovery')
  assert.equal(await evaluate('typeof window.require'), 'undefined')
  console.log(
    'PASS: demo captures, real cancellation/recovery and CSV/XLSX sample exports',
  )
}

captureDemo()
  .then(() => {
    clearTimeout(timeout)
    app.exit(0)
  })
  .catch((error: unknown) => {
    console.error(error)
    clearTimeout(timeout)
    app.exit(1)
  })
