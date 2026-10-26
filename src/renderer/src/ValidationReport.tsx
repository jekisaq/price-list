import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TablePagination from '@mui/material/TablePagination'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ProcessView, ReportFilter, ReportPage } from '../../shared/api'
import { VirtualTable } from './VirtualTable'

interface Props {
  result: ProcessView
  busy: boolean
  stale: boolean
  manual: boolean
  corrections: Record<number, string>
  onCorrection: (sourceRow: number, sku: string) => void
  onExport: () => void
}
export function ValidationReport({
  result,
  busy,
  stale,
  onExport,
  manual,
  corrections,
  onCorrection,
}: Props) {
  const [filter, setFilter] = useState<ReportFilter>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [view, setView] = useState<ReportPage>({
    rows: [],
    issues: [],
    total: 0,
    offset: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const messageCounts = new Map<number, number>()
  for (const issue of view.issues) {
    if (issue.sourceRow !== null)
      messageCounts.set(
        issue.sourceRow,
        (messageCounts.get(issue.sourceRow) ?? 0) + 1,
      )

  }
  const maxMessages = Math.max(0, ...messageCounts.values())
  const editing =
    manual &&
    view.rows.some(
      (row) => row.duplicate || corrections[row.sourceRow] !== undefined,
    )
  const rowHeight =
    maxMessages > 0 ? Math.min(360, 80 + maxMessages * 80) : editing ? 96 : 48
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    window.api
      .reportPage({
        id: result.id,
        offset: page * pageSize,
        limit: pageSize,
        filter,
      })
      .then((response) => {
        if (!active)
          return

        if (!response.ok)
          throw new Error(response.error)

        setView(response.value)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Не удалось загрузить отчёт.',
          )

      })
      .finally(() => {
        if (active)
          setLoading(false)

      })
    return () => {
      active = false
    }
  }, [result.id, page, pageSize, filter])
  return (
    <Stack spacing={2} sx={{ my: 2 }}>
      <Typography>
        Готово товаров: {result.productCount}. Ошибок: {result.errorCount}.
      </Typography>
      <Box role="status" aria-label="Сводка проверки">
        <Typography>
          Обработано строк: {result.summary.processed}. Корректных строк:{' '}
          {result.summary.valid}.
        </Typography>
        <Typography>
          Строк с ошибками: {result.summary.invalid}. Строк в группах дублей:{' '}
          {result.summary.duplicates}. Исключено строк:{' '}
          {result.summary.excluded}.
        </Typography>
        <Typography color="text.secondary">
          Предупреждений: {result.warningCount}. Корректные строки включают
          дубли, разрешённые выбранным правилом.
        </Typography>
      </Box>
      {result.errorCount > 0 && (
        <Alert severity="error">
          Экспорт прайса заблокирован. Исправьте данные в исходном файле или
          настройки и повторите обработку. Отчёт можно сохранить сейчас.
        </Alert>
      )}
      {result.importWarnings.map((issue, index) => (
        <Alert key={index} severity={issue.severity}>
          Предупреждение импорта: {issue.message}
        </Alert>
      ))}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="Фильтр строк"
          value={filter}
          disabled={busy}
          sx={{ width: { xs: '100%', sm: 280 } }}
          slotProps={{ select: { native: true } }}
          onChange={(event) => {
            setFilter(event.target.value as ReportFilter)
            setPage(0)
          }}
        >
          <option value="all">Все строки</option>
          <option value="errors">С ошибками</option>
          <option value="duplicates">Дубли</option>
          <option value="warnings">С предупреждениями</option>
          <option value="excluded">Исключённые</option>
          <option value="ready">Готовые к экспорту</option>
        </TextField>
        <Button
          variant="outlined"
          disabled={busy || stale}
          onClick={onExport}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          Сохранить отчёт CSV…
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Показано строк: {view.total} из {result.summary.processed}. Отчёт CSV
        содержит все ошибки и предупреждения независимо от фильтра. Длинные
        значения сокращены в предпросмотре.
      </Typography>
      {loading && <LinearProgress aria-label="Загрузка страницы отчёта" />}
      {error && <Alert severity="error">{error}</Alert>}
      <VirtualTable
        key={`${result.id}:${filter}:${page}:${pageSize}`}
        rows={view.rows}
        label="Отчёт проверки"
        height={560}
        rowHeight={rowHeight}
        widths={[48, editing ? 160 : 100, 100, 90, 90, 250]}
        headers={[
          'Строка',
          'Артикул',
          'Наименование',
          'Исходная цена',
          'Цена с наценкой',
          'Статус и сообщения',
        ]}
        rowKey={(row) => row.sourceRow}
        render={(row) => [
          row.sourceRow,
          manual &&
          (row.duplicate || corrections[row.sourceRow] !== undefined) ? (
            <TextField
              label={`Артикул — строка ${row.sourceRow}`}
              value={corrections[row.sourceRow] ?? row.sku}
              disabled={busy}
              onChange={(event) =>
                onCorrection(row.sourceRow, event.target.value)
              }
            />
          ) : (
            row.sku || '—'
          ),
          row.name || '—',
          row.originalPrice === null
            ? row.rawPrice || 'Пусто'
            : row.originalPrice.toFixed(2),
          row.price?.toFixed(2) ?? '—',
          <>
            <Typography variant="body2">
              {[
                row.hasErrors
                  ? 'Ошибка'
                  : row.excluded
                    ? 'Исключена'
                    : 'Готова',
                row.duplicate ? 'Дубль' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
            {view.issues
              .filter((issue) => issue.sourceRow === row.sourceRow)
              .map((issue, index) => (
                <Box key={index} sx={{ mt: 1 }}>
                  <Typography
                    variant="body2"
                    color={
                      issue.severity === 'error' ? 'error.main' : 'warning.dark'
                    }
                  >
                    {issue.severity === 'error' ? 'Ошибка' : 'Предупреждение'} —
                    строка {issue.sourceRow}, колонка{' '}
                    {(issue.columnIndex ?? 0) + 1} «{issue.columnName}».
                    Значение: {JSON.stringify(issue.value)}.
                  </Typography>
                  <Typography variant="body2">{issue.message}</Typography>
                </Box>
              ))}
          </>,
        ]}
      />
      <TablePagination
        component="div"
        count={view.total}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[20, 50, 200]}
        labelRowsPerPage="Строк на странице:"
        labelDisplayedRows={({ from, to, count }) =>
          `${from}–${to} из ${count}`
        }
        getItemAriaLabel={(type) =>
          type === 'next' ? 'Следующая страница' : 'Предыдущая страница'
        }
        onPageChange={(_event, next) => setPage(next)}
        onRowsPerPageChange={(event) => {
          setPageSize(Number(event.target.value))
          setPage(0)
        }}
      />
    </Stack>
  )
}
