import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import type { OperationProgress } from '../shared/api'
import { OperationCanceled } from './services/task-context.ts'

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  flag: Int32Array
  kind?: OperationProgress['kind']
  temporary?: string
  timer?: ReturnType<typeof setTimeout>
}
export class WorkerClient {
  private worker: Worker | undefined
  private pending = new Map<string, Pending>()
  private active: string | undefined
  private disposed = false
  private resetting: Promise<void> | undefined
  constructor(
    privateUrl: URL = new URL('./worker.js', import.meta.url),
    listener: (progress: OperationProgress) => void = () => undefined,
  ) {
    this.url = privateUrl
    this.listener = listener
  }
  private url: URL
  private listener: (progress: OperationProgress) => void
  private start(): Worker {
    if (this.disposed)
      throw new Error('Окно закрыто.')

    if (this.worker)
      return this.worker

    const worker = new Worker(this.url, {
      // Start independently of main's debugger and process-only flags.
      // Type stripping is needed when running directly from TypeScript sources.
      execArgv: process.execArgv.filter(
        (argument) => argument === '--experimental-strip-types',
      ),
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    })
    this.worker = worker
    worker.on(
      'message',
      (message: {
        id: string
        value?: unknown
        error?: string
        canceled?: boolean
        progress?: Partial<OperationProgress>
      }) => {
        if (this.worker !== worker)
          return

        const task = this.pending.get(message.id)
        if (!task)
          return

        if (message.progress) {
          if (task.kind)
            this.listener({
              id: message.id,
              kind: task.kind,
              state: 'running',
              ...message.progress,
            } as OperationProgress)

          return
        }
        if (!message.error && Atomics.load(task.flag, 0) === 1) {
          void this.reset(new OperationCanceled())
          return
        }
        this.pending.delete(message.id)
        if (this.active === message.id)
          this.active = undefined

        clearTimeout(task.timer)
        if (task.kind)
          this.listener({
            id: message.id,
            kind: task.kind,
            state: message.canceled
              ? 'canceled'
              : message.error
                ? 'failed'
                : 'completed',
            stage: message.error ?? 'Готово',
            processedRows: 0,
            totalRows: null,
            percent: message.error ? null : 100,
            cancellable: false,
          })

        if (message.error)
          task.reject(
            message.canceled
              ? new OperationCanceled()
              : new Error(message.error),
          )

        else task.resolve(message.value)
      },
    )
    worker.on('error', (error: Error) => {
      if (this.worker === worker)
        void this.reset(
          new Error(
            `Рабочий процесс остановлен: ${error.message}. Выберите файл снова.`,
          ),
        )

    })
    worker.on('exit', () => {
      if (this.worker === worker)
        void this.reset(
          new Error('Рабочий процесс остановлен. Выберите файл снова.'),
        )

    })
    return worker
  }
  request<T>(
    command: string,
    data: unknown,
    kind?: OperationProgress['kind'],
  ): Promise<T> {
    if (this.active || this.resetting)
      return Promise.reject(
        new Error('Дождитесь завершения текущей операции или отмените её.'),
      )

    const id = randomUUID()
    const flag = new Int32Array(new SharedArrayBuffer(4))
    return new Promise<T>((resolve, reject) => {
      try {
        const worker = this.start()
        const temporary =
          command === 'export'
            ? (data as { temporary: string }).temporary
            : undefined
        this.pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          flag,
          kind,
          temporary,
        })
        if (kind) {
          this.active = id
          this.listener({
            id,
            kind,
            state: 'running',
            stage: 'Подготовка операции',
            processedRows: 0,
            totalRows: null,
            percent: null,
            cancellable: true,
          })
        }
        worker.postMessage({ id, command, data, flag: flag.buffer })
      } catch (error) {
        this.pending.delete(id)
        this.active = undefined
        reject(error)
      }
    })
  }
  cancel(id: string): boolean {
    const task = this.pending.get(id)
    if (
      !task ||
      !task.kind ||
      this.active !== id ||
      Atomics.compareExchange(task.flag, 0, 0, 1) !== 0
    )
      return false

    task.timer = setTimeout(() => {
      void this.reset(new OperationCanceled())
    }, 3000)
    return true
  }
  private reset(error: Error): Promise<void> {
    this.resetting ??= this.performReset(error).finally(() => {
      this.resetting = undefined
    })
    return this.resetting
  }
  private async performReset(error: Error) {
    const worker = this.worker
    this.worker = undefined
    const pending = [...this.pending.entries()]
    this.pending.clear()
    this.active = undefined
    await worker?.terminate()
    for (const [id, task] of pending) {
      clearTimeout(task.timer)
      if (task.temporary)
        await fs.unlink(task.temporary).catch(() => undefined)

      if (task.kind)
        this.listener({
          id,
          kind: task.kind,
          state: error instanceof OperationCanceled ? 'canceled' : 'failed',
          stage: error.message,
          processedRows: 0,
          totalRows: null,
          percent: null,
          cancellable: false,
          invalidated: true,
        })

      task.reject(error)
    }
  }
  async dispose() {
    this.disposed = true
    await this.reset(new OperationCanceled())
  }
}
