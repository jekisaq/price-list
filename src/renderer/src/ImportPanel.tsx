import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type {
  CsvDelimiter,
  CsvEncoding,
  ImportedTable,
  Result,
  SourceFile,
} from '../../shared/api'
import { ImportPreview } from './ImportPreview'

interface Props {
  busy: boolean
  ready: boolean
  table: ImportedTable | undefined
  run: (action: () => Promise<void>) => Promise<void>
  onImported: (table: ImportedTable) => void
  onReset: () => void
  onNext: () => void
}

function unwrap<T>(response: Result<T>): T {
  if (!response.ok)
    throw new Error(response.error)

  return response.value
}

export function ImportPanel({
  busy,
  ready,
  table,
  run,
  onImported,
  onReset,
  onNext,
}: Props) {
  const [source, setSource] = useState<SourceFile>()
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',')
  const [encoding, setEncoding] = useState<CsvEncoding>('utf-8')
  const [sheet, setSheet] = useState('')
  const [headerRow, setHeaderRow] = useState('1')
  const [canceled, setCanceled] = useState(false)
  const validHeader =
    /^\d+$/.test(headerRow) &&
    Number(headerRow) >= 1 &&
    Number(headerRow) <= 100_000

  function invalidate() {
    onReset()
    setCanceled(false)
  }

  return (
    <>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Выберите CSV или XLSX поставщика. До 20 МиБ, 100 000 строк, 256 колонок
        и 1 000 000 ячеек. В предпросмотре отображаются первые 100 строк
        товаров.
      </Typography>
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ flexWrap: 'wrap', mb: 2 }}
      >
        <Button
          disabled={busy || !ready}
          onClick={() =>
            void run(async () => {
              const selected = unwrap(await window.api.openFile())
              if (!selected) {
                setCanceled(true)
                return
              }
              invalidate()
              setSource(selected)
              setSheet(selected.sheets[0] ?? '')
              setHeaderRow('1')
              setDelimiter(',')
              setEncoding('utf-8')
            })
          }
        >
          Выбрать CSV / XLSX…
        </Button>
        <Button
          variant="outlined"
          disabled={busy || !ready}
          onClick={() =>
            void run(async () => {
              const imported = unwrap(
                await window.api.importTable({ source: 'demo' }),
              )
              setSource(undefined)
              setCanceled(false)
              onImported(imported)
              onNext()
            })
          }
        >
          Загрузить демонстрационную таблицу
        </Button>
      </Stack>
      {canceled && (
        <Alert severity="info" role="status" sx={{ mb: 2 }}>
          Выбор файла отменён.
        </Alert>
      )}
      {source && (
        <>
          <Typography sx={{ mb: 2, overflowWrap: 'anywhere' }}>
            Файл: {source.name}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 2,
              mb: 2,
            }}
          >
            {source.format === 'csv' ? (
              <>
                <TextField
                  select
                  label="Разделитель CSV"
                  value={delimiter}
                  disabled={busy}
                  slotProps={{ select: { native: true } }}
                  onChange={(event) => {
                    setDelimiter(event.target.value as CsvDelimiter)
                    invalidate()
                  }}
                >
                  <option value=",">Запятая (,)</option>
                  <option value=";">Точка с запятой (;)</option>
                  <option value={'\t'}>Табуляция</option>
                </TextField>
                <TextField
                  select
                  label="Кодировка CSV"
                  value={encoding}
                  disabled={busy}
                  slotProps={{ select: { native: true } }}
                  onChange={(event) => {
                    setEncoding(event.target.value as CsvEncoding)
                    invalidate()
                  }}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="windows-1251">Windows-1251</option>
                  <option value="utf-16le">UTF-16LE</option>
                </TextField>
              </>
            ) : (
              <TextField
                select
                label="Лист XLSX"
                value={sheet}
                disabled={busy}
                slotProps={{ select: { native: true } }}
                onChange={(event) => {
                  setSheet(event.target.value)
                  invalidate()
                }}
              >
                {source.sheets.map((name) => (
                  <option value={name} key={name}>
                    {name}
                  </option>
                ))}
              </TextField>
            )}
            <TextField
              label="Строка заголовков"
              type="number"
              value={headerRow}
              disabled={busy}
              error={!validHeader}
              helperText={
                validHeader
                  ? 'Номер исходной строки, начиная с 1'
                  : 'Введите целое число от 1 до 100 000'
              }
              slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
              onChange={(event) => {
                setHeaderRow(event.target.value)
                invalidate()
              }}
            />
          </Box>
          <Button
            variant="outlined"
            disabled={busy || !validHeader}
            onClick={() =>
              void run(async () => {
                onReset()
                const imported = unwrap(
                  await window.api.importTable({
                    source: 'file',
                    sourceId: source.id,
                    options: {
                      delimiter,
                      encoding,
                      sheet,
                      headerRow: Number(headerRow),
                    },
                  }),
                )
                onImported(imported)
              })
            }
          >
            Показать предпросмотр
          </Button>
        </>
      )}
      {table && (
        <>
          <ImportPreview table={table} />
          <Button disabled={busy} onClick={onNext}>
            Перейти к сопоставлению
          </Button>
        </>
      )}
    </>
  )
}
