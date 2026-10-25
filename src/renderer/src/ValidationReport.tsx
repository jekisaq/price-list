import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ProcessResult, ValidationIssue } from '../../shared/api'
import { filterReportRows } from '../../shared/report'
import type { ReportFilter } from '../../shared/report'

interface Props {
  result: ProcessResult
  busy: boolean
  stale: boolean
  onExport: () => void
}

export function ValidationReport({ result, busy, stale, onExport }: Props) {
  const [filter, setFilter] = useState<ReportFilter>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const rows = useMemo(() => filterReportRows(result, filter), [result, filter])
  const byRow = useMemo(() => {
    const grouped = new Map<number, ValidationIssue[]>()
    for (const issue of result.issues) {
      if (issue.sourceRow === null)
        continue

      const messages = grouped.get(issue.sourceRow) ?? []
      messages.push(issue)
      grouped.set(issue.sourceRow, messages)
    }
    return grouped
  }, [result])
  const errors = result.issues.filter(
    (issue) => issue.severity === 'error',
  ).length
  const warnings = result.issues.length - errors
  return (
    <Stack spacing={2} sx={{ my: 2 }}>
      <Typography>
        Готово товаров: {result.products.length}. Ошибок: {errors}.
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
          Предупреждений: {warnings}. Корректные строки включают дубли,
          разрешённые выбранным правилом.
        </Typography>
      </Box>
      {errors > 0 && (
        <Alert severity="error">
          Экспорт прайса заблокирован. Исправьте данные в исходном файле или
          настройки и повторите обработку. Отчёт можно сохранить сейчас.
        </Alert>
      )}
      {result.issues
        .filter((issue) => issue.sourceRow === null)
        .map((issue, index) => (
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
        Показано строк: {rows.length} из {result.rows.length}. Отчёт CSV
        содержит все ошибки и предупреждения независимо от фильтра.
      </Typography>
      <TableContainer sx={{ maxHeight: 560 }}>
        <Table size="small" stickyHeader aria-label="Отчёт проверки">
          <TableHead>
            <TableRow>
              <TableCell>Строка</TableCell>
              <TableCell>Артикул</TableCell>
              <TableCell>Наименование</TableCell>
              <TableCell>Исходная цена</TableCell>
              <TableCell>Цена с наценкой</TableCell>
              <TableCell>Статус и сообщения</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => (
              <TableRow key={row.sourceRow} sx={{ verticalAlign: 'top' }}>
                <TableCell>{row.sourceRow}</TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>
                  {row.sku || '—'}
                </TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>
                  {row.name || '—'}
                </TableCell>
                <TableCell sx={{ maxWidth: 160, overflowWrap: 'anywhere' }}>
                  {row.originalPrice === null
                    ? row.rawPrice || 'Пусто'
                    : row.originalPrice.toFixed(2)}
                </TableCell>
                <TableCell>{row.price?.toFixed(2) ?? '—'}</TableCell>
                <TableCell sx={{ minWidth: 240, overflowWrap: 'anywhere' }}>
                  <Typography
                    variant="body2"
                    color={row.hasErrors ? 'error.main' : 'text.secondary'}
                  >
                    {[
                      row.hasErrors
                        ? 'Ошибка'
                        : row.excluded
                          ? 'Исключена'
                          : 'Готова',
                      row.duplicate ? 'Дубль' : '',
                      row.hasErrors && row.excluded ? 'Исключена' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  {(byRow.get(row.sourceRow) ?? []).map((issue, index) => (
                    <Box key={index} sx={{ mt: 1 }}>
                      <Typography
                        variant="body2"
                        color={
                          issue.severity === 'error'
                            ? 'error.main'
                            : 'warning.dark'
                        }
                      >
                        {issue.severity === 'error'
                          ? 'Ошибка'
                          : 'Предупреждение'}{' '}
                        — строка {issue.sourceRow}, колонка{' '}
                        {(issue.columnIndex ?? 0) + 1} «{issue.columnName}».
                        Значение: {JSON.stringify(issue.value)}.
                      </Typography>
                      <Typography variant="body2">{issue.message}</Typography>
                    </Box>
                  ))}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  Нет строк для выбранного фильтра.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[20, 50]}
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
