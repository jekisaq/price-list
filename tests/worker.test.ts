import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { WorkerClient } from '../src/main/worker-client.ts'
import {
  importCsvFile,
  openRuntimeSource,
  streamExport,
} from '../src/main/services/streaming.ts'
import {
  taskContext,
  OperationCanceled,
} from '../src/main/services/task-context.ts'
import {
  demoTable,
  processTable,
  toCsv,
  toReportCsv,
} from '../src/main/services/workflow.ts'
import { importSource, loadSource } from '../src/main/services/import-file.ts'
import type {
  ImportedTable,
  OperationProgress,
  ProcessView,
  ReportPage,
  SourceFile,
} from '../src/shared/api.ts'

const options = {
  delimiter: ',' as const,
  encoding: 'utf-8' as const,
  sheet: '',
  headerRow: 1,
}
const workerUrl = new URL('../src/main/data-worker.ts', import.meta.url)
const context = () =>
  taskContext(new Int32Array(new SharedArrayBuffer(4)), () => undefined)
async function fixture(action: (path: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'price-list-worker-'))
  try {
    await action(directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('streaming CSV retains multiline physical row numbers, encodings and values across chunk boundaries', async () => {
  await fixture(async (directory) => {
    for (const encoding of ['utf-8', 'utf-16le'] as const) {
      const path = join(directory, `${encoding}.csv`)
      const content =
        '\uFEFFПоставщик\r\n\r\nАртикул,Название,Цена\r\n\r\n001,"много\r\nстрок",10\r\n' +
        Array.from(
          { length: 3000 },
          (_, index) => `${index + 2},${'я'.repeat(20)},20`,
        ).join('\r\n')
      await fs.writeFile(
        path,
        content,
        encoding === 'utf-8' ? 'utf8' : 'utf16le',
      )
      const selected = await openRuntimeSource(path, context())
      const opts = { ...options, encoding, headerRow: 3 }
      const streamed = await importCsvFile(selected, opts, context())
      const original = importSource(await loadSource(path), opts)
      assert.deepEqual({ ...streamed, id: '' }, { ...original, id: '' })
      assert.deepEqual(streamed.rowNumbers.slice(0, 2), [5, 7])
    }
  })
})

test('streamed CSV/report/XLSX exports match contents and preserve types', async () => {
  await fixture(async (directory) => {
    const result = processTable(demoTable(), {
      importId: '',
      mapping: { sku: 0, name: 1, price: 2 },
      markup: 20,
    })
    for (const report of [false, true]) {
      const path = join(directory, report ? 'report.csv' : 'price.csv')
      await streamExport(path, `${path}.tmp`, result, 'csv', report, context())
      assert.equal(
        await fs.readFile(path, 'utf8'),
        report ? toReportCsv(result) : toCsv(result),
      )
    }
    const path = join(directory, 'price.xlsx')
    await streamExport(path, `${path}.tmp`, result, 'xlsx', false, context())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(path)
    assert.equal(workbook.worksheets[0]?.getCell('A2').value, '001')
    assert.equal(
      workbook.worksheets[0]?.getCell('A2').type,
      ExcelJS.ValueType.String,
    )
    assert.equal(workbook.worksheets[0]?.getCell('C2').value, 144)
    assert.equal(workbook.worksheets[0]?.getCell('C2').numFmt, '0.00')
    assert.deepEqual((await fs.readdir(directory)).sort(), [
      'price.csv',
      'price.xlsx',
      'report.csv',
    ])
  })
})

test('canceling a partially written export preserves destination and removes temporary files', async () => {
  await fixture(async (directory) => {
    const table = demoTable()
    table.rows = Array.from({ length: 5000 }, (_, index) => [
      String(index),
      'Товар',
      '20',
    ])
    table.rowNumbers = table.rows.map((_, index) => index + 2)
    const result = processTable(table, {
      importId: '',
      mapping: { sku: 0, name: 1, price: 2 },
      markup: 20,
    })
    for (const format of ['csv', 'xlsx'] as const) {
      const path = join(directory, `price.${format}`)
      await fs.writeFile(path, 'original')
      const flag = new Int32Array(new SharedArrayBuffer(4))
      const ctx = taskContext(flag, (progress) => {
        if (progress.stage.startsWith('Запись'))
          Atomics.store(flag, 0, 1)

      })
      await assert.rejects(
        () => streamExport(path, `${path}.tmp`, result, format, false, ctx),
        OperationCanceled,
      )
      assert.equal(await fs.readFile(path, 'utf8'), 'original')
      await assert.rejects(() => fs.stat(`${path}.tmp`), { code: 'ENOENT' })
    }
  })
})

test('worker retains full data, sends bounded summaries/pages and rejects canceled or stale work', async () => {
  await fixture(async (directory) => {
    const path = join(directory, 'large.csv')
    await fs.writeFile(
      path,
      'Артикул,Наименование,Цена\n' +
        Array.from(
          { length: 30000 },
          (_, index) => `${String(index).padStart(6, '0')},Товар ${index},10`,
        ).join('\n'),
    )
    let cancel: OperationProgress['kind'] | undefined
    let accepted = false
    const events: OperationProgress[] = []
    let client: WorkerClient
    client = new WorkerClient(workerUrl, (event) => {
      events.push(event)
      if (
        event.kind === cancel &&
        event.state === 'running' &&
        event.stage !== 'Подготовка операции' &&
        !accepted
      )
        accepted = client.cancel(event.id)

    })
    try {
      const source = await client.request<SourceFile>('open', { path }, 'open')
      cancel = 'import'
      await assert.rejects(
        () =>
          client.request(
            'import',
            { source: 'file', sourceId: source.id, options },
            'import',
          ),
        /отменена/,
      )
      assert.equal(accepted, true)
      cancel = undefined
      const imported = await client.request<ImportedTable>(
        'import',
        { source: 'file', sourceId: source.id, options },
        'import',
      )
      assert.equal(imported.totalRows, 30000)
      assert.equal(imported.rows.length, 100)
      const request = {
        importId: imported.id,
        mapping: { sku: 0, name: 1, price: 2 },
        markup: 20,
      }
      cancel = 'process'
      accepted = false
      await assert.rejects(
        () => client.request('process', request, 'process'),
        /отменена/,
      )
      assert.equal(accepted, true)
      cancel = undefined
      const processed = await client.request<ProcessView>(
        'process',
        request,
        'process',
      )
      assert.equal(processed.productCount, 30000)
      assert.equal('rows' in processed, false)
      assert.equal('products' in processed, false)
      assert.equal('issues' in processed, false)
      const page = await client.request<ReportPage>('reportPage', {
        id: processed.id,
        offset: 29990,
        limit: 10,
        filter: 'all',
      })
      assert.equal(page.rows[9]?.sku, '029999')
      assert.equal(page.rows[9]?.price, 12)
      const destination = join(directory, 'price.csv')
      const temporary = join(directory, '.price-list-test.tmp')
      await fs.writeFile(destination, 'original')
      cancel = 'export'
      accepted = false
      await assert.rejects(
        () =>
          client.request(
            'export',
            {
              resultId: processed.id,
              format: 'csv',
              path: destination,
              temporary,
            },
            'export',
          ),
        /отменена/,
      )
      assert.equal(accepted, true)
      assert.equal(await fs.readFile(destination, 'utf8'), 'original')
      await assert.rejects(() => fs.stat(temporary), { code: 'ENOENT' })
      cancel = undefined
      await client.request('import', { source: 'demo' }, 'import')
      await assert.rejects(
        () =>
          client.request('reportPage', {
            id: processed.id,
            offset: 0,
            limit: 20,
            filter: 'all',
          }),
        /устарел/,
      )
      await assert.rejects(
        () => client.request('process', request, 'process'),
        /устарела/,
      )
      assert.ok(
        events.some(
          (event) => event.stage === 'Чтение CSV' && event.percent !== null,
        ),
      )
      assert.equal(client.cancel('not-an-operation'), false)
    } finally {
      await client.dispose()
    }
  })
})

test('an unresponsive worker is terminated, its temporary file removed and its result invalidated', async () => {
  await fixture(async (directory) => {
    const path = join(directory, 'stuck.mjs')
    await fs.writeFile(
      path,
      "import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0))",
    )
    const temporary = join(directory, '.price-list-stuck.tmp')
    await fs.writeFile(temporary, 'partial')
    let active = ''
    let invalidated = false
    const client = new WorkerClient(pathToFileURL(path), (event) => {
      if (event.state === 'running')
        active = event.id

      if (event.invalidated)
        invalidated = true

    })
    try {
      const promise = client.request('export', { temporary }, 'export')
      const rejected = assert.rejects(promise, /отменена/)
      assert.equal(client.cancel(active), true)
      await assert.rejects(() => client.request('metrics', {}), /Дождитесь/)
      await rejected
      assert.equal(invalidated, true)
      await assert.rejects(() => fs.stat(temporary), { code: 'ENOENT' })
    } finally {
      await client.dispose()
    }
  })
})
