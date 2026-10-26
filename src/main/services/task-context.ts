import type { OperationProgress } from '../../shared/api'

export class OperationCanceled extends Error {
  constructor() {
    super('Операция отменена.')
    this.name = 'OperationCanceled'
  }
}
export interface TaskContext {
  check(): void
  progress(
    stage: string,
    processedRows: number,
    totalRows?: number,
    percent?: number,
  ): void
  commit(): void
}
export function taskContext(
  flag: Int32Array,
  emit: (
    progress: Pick<
      OperationProgress,
      'stage' | 'processedRows' | 'totalRows' | 'percent' | 'cancellable'
    >,
  ) => void,
): TaskContext {
  let last = 0
  let previous = ''
  const check = () => {
    if (Atomics.load(flag, 0) === 1)
      throw new OperationCanceled()

  }
  return {
    check,
    progress(stage, processedRows, totalRows, percent) {
      check()
      const now = Date.now()
      if (
        stage !== previous ||
        now - last >= 100 ||
        (totalRows !== undefined && processedRows === totalRows)
      ) {
        last = now
        previous = stage
        emit({
          stage,
          processedRows,
          totalRows: totalRows ?? null,
          percent:
            percent ??
            (totalRows
              ? Math.min(100, Math.floor((processedRows / totalRows) * 100))
              : null),
          cancellable: Atomics.load(flag, 0) === 0,
        })
      }
    },
    commit() {
      if (Atomics.compareExchange(flag, 0, 0, 2) === 1)
        throw new OperationCanceled()

      emit({
        stage: 'Завершение сохранения',
        processedRows: 0,
        totalRows: null,
        percent: null,
        cancellable: false,
      })
    },
  }
}
