import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import type { PriceListApi, Result } from '../src/shared/api.ts'

interface ProtocolResult {
  result?: { value?: unknown }
  exceptionDetails?: unknown
}
const children = new Set<ChildProcess>()

// Use the production executable, with debuggers enabled only by this test launch.
// No test entry points or environment switches are added to production code.
class Connection {
  private socket: WebSocket
  private nextId = 0
  private frameId = ''
  private events = new Map<string, (() => void)[]>()
  private pending = new Map<
    number,
    {
      resolve: (value: ProtocolResult) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.method === 'Debugger.paused')
        this.frameId = message.params.callFrames[0].callFrameId

      if (message.method) {
        this.events.get(message.method)?.shift()?.()
      }
      const pending = this.pending.get(message.id)
      if (!pending)
        return

      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)))
      } else {
        pending.resolve(message.result)
      }
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Debugger disconnected'))
      }
      this.pending.clear()
    })
  }
  static async connect(url: string) {
    const socket = new WebSocket(url)
    await new Promise<void>((done, reject) => {
      socket.addEventListener('open', () => done(), { once: true })
      socket.addEventListener(
        'error',
        () => reject(new Error('Debugger connection failed')),
        { once: true },
      )
    })
    return new Connection(socket)
  }
  async send(method: string, params: object = {}): Promise<ProtocolResult> {
    const id = ++this.nextId
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Debugger request timed out: ${method}`))
      }, 15000)
      this.pending.set(id, { resolve: done, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  nextEvent(method: string): Promise<void> {
    return new Promise((done) => {
      this.events.set(method, [...(this.events.get(method) ?? []), done])
    })
  }
  async isolate(path: string) {
    const response = await this.send('Debugger.evaluateOnCallFrame', {
      callFrameId: this.frameId,
      expression: `globalThis.__packagedElectron = { app, BrowserWindow, dialog }; app.setPath('userData', ${JSON.stringify(path)})`,
      returnByValue: true,
    })
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails))

  }
  async evaluate<T>(expression: string, awaitPromise = true): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails))

    return response.result?.value as T
  }
  close() {
    this.socket.close()
  }
}
async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  )
  return port
}
const delay = () => new Promise((done) => setTimeout(done, 50))
async function endpoint(port: number, child: ChildProcess, page = false) {
  for (let attempt = 0; attempt < 300; attempt++) {
    assert.equal(
      child.exitCode,
      null,
      'Packaged application exited before the test',
    )
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = (await response.json()) as {
        type: string
        webSocketDebuggerUrl: string
        url: string
      }[]
      const target = targets.find(
        (item) =>
          !page || (item.type === 'page' && item.url.startsWith('file:')),
      )
      if (target)
        return target.webSocketDebuggerUrl

    } catch {
      /* Debugging server is still starting. */
    }
    await delay()
  }
  throw new Error('Packaged application did not expose its test debugger')
}
function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  return (result as { ok: true; value: T }).value
}

async function smoke() {
  const executable = resolve(
    process.argv[2] ?? 'release/win-unpacked/Price List.exe',
  )
  const directory = await mkdtemp(resolve('out/tests/packaged-'))
  const userData = resolve(directory, 'user-data')
  const electron = 'globalThis.__packagedElectron'
  let profileId = ''
  for (const phase of ['write', 'read']) {
    const mainPort = await freePort()
    const rendererPort = await freePort()
    const child = spawn(
      executable,
      [
        `--inspect-brk=127.0.0.1:${mainPort}`,
        `--remote-debugging-port=${rendererPort}`,
        '--remote-debugging-address=127.0.0.1',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    children.add(child)
    child.once('exit', () => children.delete(child))
    let logs = ''
    child.stdout?.on('data', (data: Buffer) => {
      logs += data.toString()
    })
    child.stderr?.on('data', (data: Buffer) => {
      logs += data.toString()
    })
    child.on('error', (error) => {
      logs += error.message
    })
    let main: Connection | undefined
    let renderer: Connection | undefined
    try {
      main = await Connection.connect(await endpoint(mainPort, child))
      await main.send('Debugger.enable')
      await main.send('Debugger.setBreakpointByUrl', {
        urlRegex: '[/\\\\]out[/\\\\]main[/\\\\]main\\.js$',
        lineNumber: 0,
      })
      const bootstrap = main.nextEvent('Debugger.paused')
      await main.send('Runtime.runIfWaitingForDebugger')
      await bootstrap
      const entry = main.nextEvent('Debugger.paused')
      await main.send('Debugger.resume')
      await entry
      await main.isolate(userData)
      await main.send('Debugger.disable')
      await main.send('Runtime.enable')
      renderer = await Connection.connect(
        await endpoint(rendererPort, child, true),
      )
      for (let attempt = 0; attempt < 200; attempt++) {
        if (
          await renderer.evaluate<boolean>(
            `Boolean(window.api) && document.readyState === 'complete' && Boolean(document.querySelector('button'))`,
          )
        )
          break

        await delay()
      }
      const metadata = await main.evaluate<{
        packaged: boolean
        version: string
        userData: string
        outputDirectories: string[]
        hasIcon: boolean
      }>(
        `(() => {
        const { app } = ${electron};
        const fs = process.getBuiltinModule('fs');
        return { packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData'),
          outputDirectories: fs.readdirSync(app.getAppPath() + '/out').sort(),
          hasIcon: fs.existsSync(app.getAppPath() + '/build/icon.png') };
      })()`,
        false,
      )
      assert.equal(metadata.packaged, true)
      assert.equal(metadata.userData, userData)
      assert.deepEqual(metadata.outputDirectories, ['main', 'preload', 'renderer'])
      assert.equal(metadata.hasIcon, true)
      assert.equal(
        metadata.version,
        JSON.parse(await readFile('package.json', 'utf8')).version,
      )
      assert.equal(
        await renderer.evaluate('typeof window.require'),
        'undefined',
      )
      const api = async <K extends keyof PriceListApi>(
        method: K,
        argument?: unknown,
      ): Promise<Awaited<ReturnType<PriceListApi[K]>>> =>
        renderer!.evaluate<Awaited<ReturnType<PriceListApi[K]>>>(
          `window.api[${JSON.stringify(method)}](${argument === undefined ? '' : JSON.stringify(argument)})`,
        )
      if (phase === 'read') {
        const profiles = value(await api('getProfiles'))
        assert.equal(profiles.activeProfileId, profileId)
        assert.equal(profiles.profiles[0]?.name, 'Проверка сборки')
        assert.equal(profiles.profiles[0]?.settings.markup, 25)
      } else {
        const imported = value(await api('importTable', { source: 'demo' }))
        const settings = { markup: 25 }
        const profiles = value(
          await api('saveProfile', {
            name: 'Проверка сборки',
            importId: imported.id,
            mapping: { sku: 0, name: 1, price: 2 },
            settings,
          }),
        )
        profileId = profiles.activeProfileId!
        assert.ok(profileId)
        const processed = value(
          await api('processTable', {
            importId: imported.id,
            mapping: { sku: 0, name: 1, price: 2 },
            ...settings,
          }),
        )
        assert.equal(processed.productCount, 3)
        for (const format of ['csv', 'xlsx']) {
          const destination = resolve(directory, `price.${format}`)
          await main.evaluate(
            `${electron}.dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(destination)} })`,
          )
          const exported = value(
            await api('exportTable', { resultId: processed.id, format }),
          )
          assert.equal(exported.canceled, false)
          if (!exported.canceled)
            assert.equal(exported.count, 3)

        }
        for (const format of ['csv', 'xlsx']) {
          const path = resolve(directory, `price.${format}`)
          await main.evaluate(
            `${electron}.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(path)}] })`,
          )
          const source = value(await api('openFile'))!
          const roundtrip = value(
            await api('importTable', {
              source: 'file',
              sourceId: source.id,
              options: {
                delimiter: ';',
                encoding: 'utf-8',
                sheet: source.sheets[0] ?? '',
                headerRow: 1,
              },
            }),
          )
          assert.equal(roundtrip.totalRows, 3)
          assert.deepEqual(roundtrip.columns, [
            'Артикул',
            'Наименование',
            'Цена',
          ])
          assert.equal(roundtrip.rows[0]?.[0], '001')
          assert.equal(Number(roundtrip.rows[0]?.[2]), 150)
        }
        assert.ok(
          !(await readdir(directory)).some((name) => name.endsWith('.tmp')),
        )
      }
      const exited = once(child, 'exit')
      // Close the actual window to exercise worker disposal and normal app shutdown.
      await main.evaluate(
        `${electron}.BrowserWindow.getAllWindows()[0].close()`,
      )
      renderer.close()
      main.close()
      const [code] = await exited
      assert.equal(code, 0)
    } catch (error) {
      console.error(logs)
      throw error
    } finally {
      renderer?.close()
      main?.close()
      if (child.exitCode === null)
        child.kill()

    }
  }
  await writeFile(
    resolve(directory, 'result.json'),
    JSON.stringify({ executable, profileId, passed: true }, null, 2),
  )
  console.log(
    `PASS: packaged app, worker, CSV/XLSX export/reimport, profiles after normal close/restart. ${directory}`,
  )
}
const timeout = setTimeout(() => {
  console.error('Packaged smoke test timeout')
  for (const child of children) {
    child.kill()
  }
  process.exit(1)
}, 60000)
smoke()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => clearTimeout(timeout))
