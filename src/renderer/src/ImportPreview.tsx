import { useEffect, useState } from 'react'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import TablePagination from '@mui/material/TablePagination'
import LinearProgress from '@mui/material/LinearProgress'
import type { ImportedTable } from '../../shared/api'
import { VirtualTable } from './VirtualTable'

export function ImportPreview({ table }: { table: ImportedTable }) {
  const [page, setPage] = useState(0)
  const [view, setView] = useState(table)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let active = true
    setError('')
    if (page === 0) {
      setView(table)
      return
    }
    setLoading(true)
    window.api
      .importPage({ id: table.id, offset: page * 100, limit: 100 })
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
              : 'Не удалось загрузить страницу.',
          )

      })
      .finally(() => {
        if (active)
          setLoading(false)

      })
    return () => {
      active = false
    }
  }, [page, table])
  return (
    <>
      <Typography sx={{ my: 2, overflowWrap: 'anywhere' }}>
        {table.name} · Строк товаров: {table.totalRows} · Колонок:{' '}
        {table.columns.length}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Показано {view.rows.length} из {table.totalRows} строк. Обработка
        использует всю таблицу. Длинные значения сокращены в предпросмотре.
      </Typography>
      {table.warnings.map((message) => (
        <Alert severity="warning" key={message} sx={{ mt: 1 }}>
          {message}
        </Alert>
      ))}
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress />}
      <VirtualTable
        key={`${table.id}:${page}`}
        rows={view.rows}
        headers={[
          'Строка',
          ...table.columns.map((column, index) => `${index + 1}. ${column}`),
        ]}
        label="Предпросмотр импортированной таблицы"
        rowKey={(_row, index) => view.rowNumbers[index]!}
        render={(row, index) => [view.rowNumbers[index], ...row]}
      />
      <TablePagination
        component="div"
        count={table.totalRows}
        page={page}
        rowsPerPage={100}
        rowsPerPageOptions={[100]}
        labelRowsPerPage="Строк на странице:"
        labelDisplayedRows={({ from, to, count }) =>
          `${from}–${to} из ${count}`
        }
        getItemAriaLabel={(type) =>
          type === 'next'
            ? 'Следующая страница импорта'
            : 'Предыдущая страница импорта'
        }
        onPageChange={(_event, next) => {
          if (!loading)
            setPage(next)

        }}
      />
    </>
  )
}
