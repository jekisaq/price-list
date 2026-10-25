import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const timeout = setTimeout(() => {
  console.error('Smoke test timeout')
  app.exit(1)
}, 20000)
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
  
  console.log(
    'PASS: preload isolation, IPC validation, workflow, cancel and CSV export',
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
