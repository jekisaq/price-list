import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ExcelJS from 'exceljs'

const phase = process.argv[2]
const directory = resolve('out/tests/profile-restart-data')
const sourcePath = resolve('out/tests/profile-source.csv')
const timeout = setTimeout(() => {
  console.error('Profile smoke timeout')
  app.exit(1)
}, 30000)
const loaded = new Promise<BrowserWindow>((resolveWindow) => {
  app.once('browser-window-created', (_event, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', () => resolveWindow(window))
  })
})

async function smoke() {
  assert.ok(['write', 'read', 'corrupt', 'future'].includes(phase ?? ''))
  await mkdir(directory, { recursive: true })
  if (phase === 'write') {
    await unlink(resolve(directory, 'profiles.json')).catch(
      (error: unknown) => {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error

      },
    )
    await writeFile(
      sourcePath,
      '\uFEFFПоставщик\nОписание;Тариф;Идентификатор\nБлокнот;10,01;000001',
      'utf16le',
    )
  }
  if (phase === 'corrupt') {
    await writeFile(resolve(directory, 'profiles.json'), '{broken settings')
  }
  if (phase === 'future') {
    await writeFile(
      resolve(directory, 'profiles.json'),
      JSON.stringify({ version: 99, future: true }),
    )
  }
  app.setPath('userData', directory)
  await import(pathToFileURL(resolve('out/main/main.js')).href)
  const window = await loaded
  const evaluate = (script: string) =>
    window.webContents.executeJavaScript(script) as Promise<unknown>
  const delay = () => new Promise((resolveWait) => setTimeout(resolveWait, 50))
  async function wait(check: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check())
        return

      await delay()
    }
    throw new Error('Profile UI condition timed out')
  }
  const text = (value: string) =>
    wait(async () =>
      Boolean(
        await evaluate(
          `document.body.innerText.includes(${JSON.stringify(value)})`,
        ),
      ),
    )
  async function click(value: string) {
    await wait(async () =>
      Boolean(
        await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent === ${JSON.stringify(value)});
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`),
      ),
    )
    await delay()
  }
  async function change(label: string, value: string) {
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(item => item.textContent.replaceAll('*', '').trim() === ${JSON.stringify(label)});
      const field = label && document.getElementById(label.htmlFor);
      if (!field) throw new Error('Missing profile field');
      const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`)
    await delay()
  }
  const field = (label: string) =>
    evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(item => item.textContent.replaceAll('*', '').trim() === ${JSON.stringify(label)});
    return label && document.getElementById(label.htmlFor).value;
  })()`)
  async function state() {
    return (await evaluate(
      '(async () => { const response = await window.api.getProfiles(); if (!response.ok) throw new Error(response.error); return response.value })()',
    )) as {
      activeProfileId: string | null
      profiles: {
        id: string
        name: string
        mapping: unknown
        importOptions: unknown
        settings: { markup: number }
      }[]
      settings: { markup: number }
    }
  }
  async function open(path: string) {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    await click('Выбрать CSV / XLSX…')
  }
  await text('Профили поставщиков')
  await wait(async () =>
    Boolean(
      await evaluate(
        `![...document.querySelectorAll('button')].find(item => item.textContent === 'Выбрать CSV / XLSX…').disabled`,
      ),
    ),
  )
  if (phase === 'write') {
    await open(sourcePath)
    await change('Разделитель CSV', ';')
    await change('Кодировка CSV', 'utf-16le')
    await change('Строка заголовков', '2')
    await click('Показать предпросмотр')
    await text('Строк товаров: 1')
    await click('Перейти к сопоставлению')
    await change('Артикул', '2')
    await change('Наименование', '0')
    await change('Цена', '1')
    await change('Наценка, %', '37')
    await change('Округление', 'up')
    await change('Шаг округления', '1')
    await change('Обработка дублей', 'last')
    await change('Название профиля', 'Поставщик А')
    await click('Сохранить как новый')
    await text('Профиль сохранён.')
    const firstId = (await state()).activeProfileId!
    assert.ok(firstId)
    await change('Наценка, %', '38')
    await click('Обновить профиль')
    await wait(async () => (await state()).profiles[0]?.settings.markup === 38)
    await change('Наценка, %', '37')
    await click('Обновить профиль')
    await wait(async () => (await state()).profiles[0]?.settings.markup === 37)
    await change('Название профиля', 'Поставщик для перезапуска')
    await click('Переименовать')
    await text('Профиль переименован.')
    assert.equal((await state()).profiles[0]?.id, firstId)
    await change('Название профиля', 'Временный')
    await click('Сохранить как новый')
    await wait(async () => (await state()).profiles.length === 2)
    await click('Удалить профиль')
    await click('Отмена')
    assert.equal((await state()).profiles.length, 2)
    await click('Удалить профиль')
    await click('Удалить')
    await text('Профиль удалён.')
    assert.equal((await state()).profiles.length, 1)
    await change('Профиль поставщика', firstId)
    await wait(
      async () =>
        (await field('Название профиля')) === 'Поставщик для перезапуска',
    )
    const saved = JSON.parse(
      await readFile(resolve(directory, 'profiles.json'), 'utf8'),
    )
    assert.equal(saved.version, 1)
    assert.equal(saved.activeProfileId, firstId)
    assert.deepEqual(saved.profiles[0].mapping, { sku: 2, name: 0, price: 1 })
    assert.deepEqual(saved.profiles[0].importOptions, {
      delimiter: ';',
      encoding: 'utf-16le',
      sheet: '',
      headerRow: 2,
    })
    assert.deepEqual(saved.profiles[0].settings, {
      markup: 37,
      roundingMode: 'up',
      roundingStep: 1,
      duplicatePolicy: 'last',
    })
    const invalid = await evaluate(`(async () => {
      const bad = await window.api.renameProfile({ profileId: '../file', name: 'x' });
      const stale = await window.api.saveProfile({ name: 'x', importId: '00000000-0000-0000-0000-000000000000', mapping: { sku: 0, name: 1, price: 2 }, settings: { markup: 20 } });
      return [bad.ok, stale.ok];
    })()`)
    assert.deepEqual(invalid, [false, false])
    console.log(
      'PASS: profile create/update/rename/select/delete, validated IPC and disk persistence before shutdown',
    )
  } else if (phase === 'read') {
    const restored = await state()
    assert.equal(restored.profiles.length, 1)
    assert.equal(restored.settings.markup, 37)
    assert.equal(await field('Профиль поставщика'), restored.activeProfileId)
    assert.equal(await field('Название профиля'), 'Поставщик для перезапуска')
    await open(sourcePath)
    assert.equal(await field('Разделитель CSV'), ';')
    assert.equal(await field('Кодировка CSV'), 'utf-16le')
    assert.equal(await field('Строка заголовков'), '2')
    await click('Показать предпросмотр')
    await text('Строк товаров: 1')
    await click('Перейти к сопоставлению')
    assert.deepEqual(
      await evaluate(
        `['sku', 'name', 'price'].map(key => document.getElementById('mapping-' + key).value)`,
      ),
      ['2', '0', '1'],
    )
    assert.equal(await field('Наценка, %'), '37')
    assert.equal(await field('Округление'), 'up')
    assert.equal(await field('Шаг округления'), '1')
    assert.equal(await field('Обработка дублей'), 'last')
    await click('Проверить и рассчитать')
    await text('14.00')
    await text('000001')
    await evaluate('window.scrollTo(0, 0)')
    await delay()
    await writeFile(
      resolve('out/tests/profile-restored.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    // Reordering known headers restores the mapping by identity, not by old positions.
    await change('Профиль поставщика', restored.activeProfileId!)
    const reordered = resolve('out/tests/profile-reordered.csv')
    await writeFile(
      reordered,
      '\uFEFFПоставщик\nИдентификатор;Описание;Тариф\n000001;Блокнот;10,01',
      'utf16le',
    )
    await open(reordered)
    await click('Показать предпросмотр')
    await text('Строк товаров: 1')
    await click('Перейти к сопоставлению')
    await text('Порядок колонок изменился.')
    assert.deepEqual(
      await evaluate(
        `['sku', 'name', 'price'].map(key => document.getElementById('mapping-' + key).value)`,
      ),
      ['0', '1', '2'],
    )
    await change('Профиль поставщика', restored.activeProfileId!)
    const incompatible = resolve('out/tests/profile-incompatible.csv')
    await writeFile(
      incompatible,
      '\uFEFFПоставщик\nОписание;Другая цена;Идентификатор\nБлокнот;10,01;000001',
      'utf16le',
    )
    await open(incompatible)
    await click('Показать предпросмотр')
    await text('Строк товаров: 1')
    await click('Перейти к сопоставлению')
    await text('отсутствуют или неоднозначны колонки')
    assert.equal(
      await evaluate(`document.getElementById('mapping-price').value`),
      '',
    )
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(item => item.textContent === 'Проверить и рассчитать').disabled`,
      ),
      true,
    )
    // XLSX profiles restore the worksheet, and a missing saved worksheet requires a choice.
    await click('Назад')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Товары')
    sheet.addRow(['Поставщик'])
    sheet.addRow(['Описание', 'Тариф', 'Идентификатор'])
    sheet.addRow(['Блокнот', 10.01, '000001'])
    const originalBook = resolve('out/tests/profile-book.xlsx')
    await workbook.xlsx.writeFile(originalBook)
    await open(originalBook)
    await text('Профиль создан для CSV, выбран XLSX.')
    await click('Показать предпросмотр')
    await text('Строк товаров: 1')
    await click('Перейти к сопоставлению')
    await change('Название профиля', 'XLSX поставщик')
    await click('Сохранить как новый')
    await text('Профиль сохранён.')
    await click('Назад')
    sheet.name = 'Другие товары'
    const changedBook = resolve('out/tests/profile-book-changed.xlsx')
    await workbook.xlsx.writeFile(changedBook)
    await open(changedBook)
    await text('Сохранённый лист не найден.')
    assert.equal(await field('Лист XLSX'), '')
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(item => item.textContent === 'Показать предпросмотр').disabled`,
      ),
      true,
    )
    await change('Лист XLSX', 'Другие товары')
    await click('Показать предпросмотр')
    await text('Строк товаров: 1')
    await click('Перейти к сопоставлению')
    await click('Проверить и рассчитать')
    await text('14.00')
    console.log(
      'PASS: settings restored after a real Electron process restart, CSV/XLSX options, compatible mapping and missing columns/worksheets',
    )
  } else {
    await text(
      phase === 'corrupt'
        ? 'Настройки повреждены.'
        : 'Версия настроек 99 не поддерживается.',
    )
    await click('Загрузить демонстрационную таблицу')
    await click('Проверить и рассчитать')
    await text('144.00')
    if (phase === 'corrupt') {
      const backup = (await readdir(directory)).find((name) =>
        name.startsWith('profiles.corrupt-'),
      )!
      assert.equal(
        await readFile(resolve(directory, backup), 'utf8'),
        '{broken settings',
      )
      assert.equal(
        JSON.parse(await readFile(resolve(directory, 'profiles.json'), 'utf8'))
          .version,
        1,
      )
    } else {
      assert.equal(
        JSON.parse(await readFile(resolve(directory, 'profiles.json'), 'utf8'))
          .version,
        99,
      )
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('button')].find(item => item.textContent === 'Сохранить как новый').disabled`,
        ),
        true,
      )
    }
    console.log(
      `PASS: ${phase} settings warning, safe defaults and usable processing`,
    )
  }
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
