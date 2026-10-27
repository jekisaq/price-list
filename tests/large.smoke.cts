import { app, BrowserWindow, dialog } from 'electron'
import assert from 'node:assert/strict'
import { mkdtemp, open, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import ExcelJS from 'exceljs'

const timeout = setTimeout(() => {
  console.error('Large-file test timeout')
  app.exit(1)
}, 60000)
const loaded = new Promise<BrowserWindow>((resolveWindow) => {
  app.once('browser-window-created', (_event, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', () => resolveWindow(window))
  })
})
const MB = 1024 * 1024
async function smoke() {
  app.setPath('userData', await mkdtemp(resolve('out/tests/large-user-data-')))
  const csv = resolve('out/tests/large-100k.csv')
  const cancellation = resolve('out/tests/cancel-400k.csv')
  for (const [path, count] of [
    [csv, 100000],
    [cancellation, 400000],
  ] as const) {
    const file = await open(path, 'w')
    try {
      await file.writeFile('Артикул,Наименование,Цена\n')
      for (let offset = 0; offset < count; offset += 1000) {
        await file.writeFile(
          Array.from(
            { length: Math.min(1000, count - offset) },
            (_, index) =>
              `${String(offset + index).padStart(8, '0')},Товар ${offset + index},10.25`,
          ).join('\n') + '\n',
        )
      }
    } finally {
      await file.close()
    }
  }
  const xlsx = resolve('out/tests/large-25k.xlsx')
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: xlsx,
    useStyles: true,
    useSharedStrings: false,
  })
  const sheet = book.addWorksheet('Товары')
  sheet.addRow(['Артикул', 'Наименование', 'Цена']).commit()
  for (let index = 0; index < 25000; index++) {
    sheet
      .addRow([String(index).padStart(8, '0'), `Товар ${index}`, 10.25])
      .commit()
    if (index % 1000 === 0)
      await new Promise<void>((done) => setImmediate(done))

  }
  await book.commit()
  await import(pathToFileURL(resolve('out/main/main.js')).href)
  const window = await loaded
  const evaluate = (script: string) =>
    window.webContents.executeJavaScript(script) as Promise<unknown>
  const delay = () => new Promise((done) => setTimeout(done, 20))
  async function wait(check: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await check())
        return

      await delay()
    }
    throw new Error('Large-file UI condition timed out')
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
        await evaluate(
          `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === ${JSON.stringify(value)}); if (!button || button.disabled) return false; button.click(); return true })()`,
        ),
      ),
    )
  }
  await wait(async () =>
    Boolean(
      await evaluate(
        `!!window.api && ![...document.querySelectorAll('button')].find(item => item.textContent === 'Выбрать CSV / XLSX…').disabled`,
      ),
    ),
  )
  await evaluate(
    `window.__bench = { last: performance.now(), maxGap: 0, workerHeap: 0 }; window.api.onOperation((progress) => { window.__bench.workerHeap = Math.max(window.__bench.workerHeap, progress.workerHeapBytes || 0) }); window.__tick = setInterval(() => { const now = performance.now(); window.__bench.maxGap = Math.max(window.__bench.maxGap, now - window.__bench.last); window.__bench.last = now }, 10)`,
  )
  const measurements: unknown[] = []
  for (const [path, count, format, budget] of [
    [csv, 100000, 'csv', 10000],
    [xlsx, 25000, 'xlsx', 15000],
  ] as const) {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    const destination = resolve(`out/tests/large-export.${format}`)
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: destination,
    })
    let last = performance.now()
    let maxMainGap = 0
    let mainHeap = 0
    let rss = 0
    const timer = setInterval(() => {
      const now = performance.now()
      maxMainGap = Math.max(maxMainGap, now - last)
      last = now
      mainHeap = Math.max(mainHeap, process.memoryUsage().heapUsed)
      rss = Math.max(rss, process.memoryUsage().rss)
    }, 10)
    await evaluate(
      'window.__bench.maxGap = 0; window.__bench.last = performance.now(); window.__bench.workerHeap = 0',
    )
    const started = performance.now()
    const outcome = (await evaluate(`(async () => {
      const unwrap = (response) => { if (!response.ok) throw new Error(response.error); return response.value };
      const source = unwrap(await window.api.openFile());
      const table = unwrap(await window.api.importTable({ source: 'file', sourceId: source.id, options: { delimiter: ',', encoding: 'utf-8', sheet: 'Товары', headerRow: 1 } }));
      const result = unwrap(await window.api.processTable({ importId: table.id, mapping: { sku: 0, name: 1, price: 2 }, markup: 20 }));
      const page = unwrap(await window.api.reportPage({ id: result.id, offset: ${count - 100}, limit: 100, filter: 'all' }));
      const exported = unwrap(await window.api.exportTable({ resultId: result.id, format: '${format}' }));
      const badPage = await window.api.reportPage({ id: result.id, offset: 0, limit: 500000, filter: 'all' });
      window.__oldResult = result.id;
      return { tableRows: table.totalRows, previewRows: table.rows.length, products: result.productCount, noRows: !('rows' in result) && !('products' in result), lastSku: page.rows.at(-1).sku, saved: exported.count, rejectedUnboundedPage: !badPage.ok,
        workerHeapMiB: window.__bench.workerHeap / ${MB}, rendererGapMs: window.__bench.maxGap, rendererHeapMiB: (performance.memory?.usedJSHeapSize || 0) / ${MB} };
    })()`)) as {
      tableRows: number
      previewRows: number
      products: number
      noRows: boolean
      lastSku: string
      saved: number
      rejectedUnboundedPage: boolean
      workerHeapMiB: number
      rendererGapMs: number
      rendererHeapMiB: number
    }
    const elapsedMs = performance.now() - started
    clearInterval(timer)
    assert.equal(outcome.tableRows, count)
    assert.equal(outcome.previewRows, 100)
    assert.equal(outcome.products, count)
    assert.equal(outcome.saved, count)
    assert.equal(outcome.lastSku, String(count - 1).padStart(8, '0'))
    assert.equal(outcome.noRows, true)
    assert.equal(outcome.rejectedUnboundedPage, true)
    assert.ok(
      elapsedMs < budget,
      `${format}: ${elapsedMs}ms exceeds ${budget}ms`,
    )
    assert.ok(outcome.workerHeapMiB < 512)
    assert.ok(rss / MB < 900)
    assert.ok(mainHeap / MB < 128)
    assert.ok(outcome.rendererHeapMiB < 128)
    assert.ok(maxMainGap < 250, `Main delay ${maxMainGap}`)
    assert.ok(
      outcome.rendererGapMs < 250,
      `Renderer delay ${outcome.rendererGapMs}`,
    )
    measurements.push({
      format,
      rows: count,
      elapsedMs: Math.round(elapsedMs),
      maxMainGapMs: Math.round(maxMainGap),
      mainHeapMiB: Math.round(mainHeap / MB),
      mainProcessRssMiB: Math.round(rss / MB),
      ...outcome,
    })
  }
  // Exercise the actual renderer with a large dataset and verify bounded DOM work.
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [csv] })
  await click('Выбрать CSV / XLSX…')
  await text('Файл: large-100k.csv')
  await click('Показать предпросмотр')
  await text('Строк товаров: 100000')
  assert.ok(
    Number(
      await evaluate(
        `document.querySelectorAll('table[aria-label="Предпросмотр импортированной таблицы"] tbody tr:not([data-spacer])').length`,
      ),
    ) < 30,
  )
  await evaluate(
    `document.querySelector('button[aria-label="Следующая страница импорта"]').click()`,
  )
  await text('101–200 из 100000')
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await text('Готово товаров: 100000')
  await text('00000000')
  await evaluate(
    `document.querySelector('.MuiTablePagination-select[role="combobox"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
  )
  await wait(async () =>
    Boolean(
      await evaluate(
        `!!document.querySelector('[role="option"][data-value="200"]')`,
      ),
    ),
  )
  await evaluate(
    `document.querySelector('[role="option"][data-value="200"]').click()`,
  )
  await text('1–200 из 100000')
  const visible = Number(
    await evaluate(
      `document.querySelectorAll('table[aria-label="Отчёт проверки"] tbody tr:not([data-spacer])').length`,
    ),
  )
  assert.ok(
    visible < 20,
    `Rendered ${visible} rows instead of a virtual window`,
  )
  await evaluate(
    `document.querySelector('table[aria-label="Отчёт проверки"]').parentElement.scrollTop = 20000`,
  )
  await delay()
  assert.ok(
    Number(
      await evaluate(
        `document.querySelectorAll('table[aria-label="Отчёт проверки"] tbody tr:not([data-spacer])').length`,
      ),
    ) < 20,
  )
  await wait(async () => Number(await evaluate(`document.querySelector('table[aria-label="Отчёт проверки"] tbody tr:not([data-spacer]) td').textContent`)) > 100)
  await writeFile(
    resolve('out/tests/large-report.png'),
    (await window.webContents.capturePage()).toPNG(),
  )
  // Confirm stopping an import in the UI, then open a new source and reject the old result.
  await click('Изменить сопоставление')
  await click('Назад')
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [cancellation],
  })
  await click('Выбрать CSV / XLSX…')
  await text('Файл: cancel-400k.csv')
  await evaluate(`window.__confirmedStop = false; window.__cancelPoll = setInterval(() => {
    const stop = [...document.querySelectorAll('button')].find(item => item.textContent === 'Остановить');
    if (stop) { window.__confirmedStop = true; clearInterval(window.__cancelPoll); stop.click(); return }
    const cancel = [...document.querySelectorAll('button')].find(item => item.textContent === 'Отменить операцию');
    if (cancel && !cancel.disabled) cancel.click();
  }, 5)`)
  await click('Показать предпросмотр')
  await text('Операция отменена.')
  assert.equal(await evaluate('window.__confirmedStop'), true)
  assert.equal(
    await evaluate(
      `(async () => (await window.api.reportPage({ id: window.__oldResult, offset: 0, limit: 20, filter: 'all' })).ok)()`,
    ),
    false,
  )
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [resolve('samples/csv/supplier-basic.csv')],
  })
  await click('Выбрать CSV / XLSX…')
  await text('Файл: supplier-basic.csv')
  await click('Показать предпросмотр')
  await text('Строк товаров: 10')
  await click('Перейти к сопоставлению')
  await click('Проверить и рассчитать')
  await text('Готово товаров: 10')
  assert.equal(
    (await readdir(resolve('out/tests'))).filter(
      (name) => name.startsWith('.price-list-') && name.endsWith('.tmp'),
    ).length,
    0,
  )
  await writeFile(
    resolve('out/tests/performance.json'),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        system: {
          platform: platform(),
          release: release(),
          arch: arch(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          memoryGiB: Math.round(totalmem() / (1024 ** 3)),
          runtime: process.versions,
          mode: 'production assets under Electron test harness; native dialogs stubbed',
        },
        targets: {
          csvRows: 100000,
          csvMs: 10000,
          xlsxRows: 25000,
          xlsxMs: 15000,
          workerHeapMiB: 512,
          mainProcessRssMiB: 900,
          maxEventLoopGapMs: 250,
        },
        measurements,
        virtualReportRows: visible,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify(measurements))
  console.log(
    'PASS: large CSV/XLSX budgets, bounded pages, virtual rows, cancellation confirmation, stale result rejection and recovery',
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
