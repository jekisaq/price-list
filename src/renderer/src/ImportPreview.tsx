import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import type { ImportedTable } from '../../shared/api'

export function ImportPreview({ table }: { table: ImportedTable }) {
  return (
    <>
      <Typography sx={{ my: 2, overflowWrap: 'anywhere' }}>
        {table.name} · Строк товаров: {table.totalRows} · Колонок:{' '}
        {table.columns.length}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Показано {table.rows.length} из {table.totalRows} строк. Обработка
        использует всю таблицу.
      </Typography>
      {table.warnings.map((message) => (
        <Alert severity="warning" key={message} sx={{ mt: 1 }}>
          {message}
        </Alert>
      ))}
      <TableContainer sx={{ my: 2, maxHeight: 360 }}>
        <Table
          stickyHeader
          size="small"
          aria-label="Предпросмотр импортированной таблицы"
        >
          <TableHead>
            <TableRow>
              <TableCell>Строка</TableCell>
              {table.columns.map((column, index) => (
                <TableCell key={index}>
                  {index + 1}. {column}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {table.rows.map((row, index) => (
              <TableRow key={table.rowNumbers[index]}>
                <TableCell>{table.rowNumbers[index]}</TableCell>
                {row.map((cell, cellIndex) => (
                  <TableCell
                    key={cellIndex}
                    sx={{
                      minWidth: 120,
                      maxWidth: 320,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  )
}
