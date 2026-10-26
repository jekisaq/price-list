import { useState } from 'react'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

interface Props<T> {
  rows: T[]
  headers: ReactNode[]
  label: string
  rowKey: (row: T, index: number) => string | number
  render: (row: T, index: number) => ReactNode[]
  height?: number
  rowHeight?: number
  widths?: number[]
}
export function VirtualTable<T>({
  rows,
  headers,
  label,
  rowKey,
  render,
  height = 360,
  rowHeight = 48,
  widths,
}: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const virtual = rows.length > 50
  const first = virtual
    ? Math.max(0, Math.floor(Math.max(0, scrollTop - 48) / rowHeight) - 3)
    : 0
  const start = Math.min(first, Math.max(0, rows.length - 1))
  const end = virtual
    ? Math.min(rows.length, start + Math.ceil(height / rowHeight) + 6)
    : rows.length
  const spacer = (size: number) =>
    size > 0 ? (
      <TableRow aria-hidden="true" data-spacer="true">
        <TableCell
          colSpan={headers.length}
          sx={{ height: size, p: 0, border: 0 }}
        />
      </TableRow>
    ) : null
  return (
    <TableContainer
      sx={{ maxHeight: height, overflowAnchor: 'none' }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      data-virtualized={virtual}
    >
      <Table
        stickyHeader
        size="small"
        aria-label={label}
        aria-rowcount={rows.length + 1}
      >
        <TableHead>
          <TableRow sx={{ height: 48 }}>
            {headers.map((header, index) => (
              <TableCell key={index} sx={{ minWidth: widths?.[index] }}>
                {header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {spacer(start * rowHeight)}
          {rows.slice(start, end).map((row, index) => (
            <TableRow
              key={rowKey(row, index + start)}
              aria-rowindex={start + index + 2}
              sx={{ height: rowHeight, verticalAlign: 'top' }}
            >
              {render(row, index + start).map((cell, column) => (
                <TableCell
                  key={column}
                  sx={{
                    p: 1,
                    minWidth: widths?.[column] ?? (column === 0 ? 48 : 120),
                  }}
                >
                  <Box
                    sx={{
                      height: rowHeight - 17,
                      maxWidth: 360,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {cell}
                  </Box>
                </TableCell>
              ))}
            </TableRow>
          ))}
          {spacer((rows.length - end) * rowHeight)}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={headers.length}>
                Нет строк для выбранного фильтра.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
