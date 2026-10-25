import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { productFields } from '../../shared/api'
import type { DraftMapping, ImportedTable } from '../../shared/api'
import {
  mapSourceRow,
  mappingCandidates,
  suggestMapping,
  validateMapping,
} from '../../shared/mapping'

interface Props {
  table: ImportedTable
  mapping: DraftMapping
  busy: boolean
  onChange: (mapping: DraftMapping) => void
}

export function MappingPanel({ table, mapping, busy, onChange }: Props) {
  const validation = validateMapping(mapping, table.columns.length)
  const candidates = mappingCandidates(table.columns)
  const usedColumns = new Set(Object.values(mapping))
  const skipped = table.columns
    .map((name, index) => ({ name, index }))
    .filter((column) => !usedColumns.has(column.index))

  return (
    <>
      <Typography
        color="text.secondary"
        sx={{ mb: 2, overflowWrap: 'anywhere' }}
      >
        {table.name} · Строк товаров: {table.totalRows} · Колонок:{' '}
        {table.columns.length}
      </Typography>
      <Alert severity="info" icon={false} sx={{ mb: 3 }}>
        Единый формат: артикул (текст), наименование (текст), цена (число после
        проверки). Все три поля обязательны. Совпадения по заголовкам предложены
        автоматически — проверьте их перед продолжением.
      </Alert>
      <Box
        component="fieldset"
        disabled={busy}
        sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
      >
        <Typography component="legend" sx={{ mb: 2, fontWeight: 600 }}>
          Колонки результата
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {productFields.map(({ key, label, required }) => (
            <TextField
              key={key}
              id={`mapping-${key}`}
              label={label}
              select
              required={required}
              disabled={busy}
              slotProps={{ select: { native: true } }}
              value={mapping[key] ?? ''}
              error={Boolean(validation.errors[key])}
              helperText={
                validation.errors[key]
                  ? mapping[key] === null && candidates[key].length > 1
                    ? 'Несколько подходящих колонок. Выберите нужную вручную.'
                    : validation.errors[key]
                  : 'Исходная колонка для этого поля'
              }
              onChange={(event) =>
                onChange({
                  ...mapping,
                  [key]:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            >
              <option value="">— Не выбрано —</option>
              {table.columns.map((column, index) => (
                <option value={index} key={index}>
                  {index + 1}. {column}
                </option>
              ))}
            </TextField>
          ))}
        </Box>
        <Button
          variant="text"
          disabled={busy}
          sx={{ mt: 1 }}
          onClick={() => onChange(suggestMapping(table.columns))}
        >
          Предложить по заголовкам
        </Button>
      </Box>
      <Box sx={{ my: 3 }}>
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
          Пропускаемые колонки ({skipped.length})
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Колонки, не выбранные выше, не попадут в результат. Чтобы включить
          колонку, назначьте её одному из полей.
        </Typography>
        <Stack
          direction="row"
          useFlexGap
          sx={{ gap: 1, flexWrap: 'wrap' }}
          aria-label="Пропускаемые колонки"
        >
          {skipped.map((column) => (
            <Chip
              key={column.index}
              variant="outlined"
              size="small"
              label={`${column.index + 1}. ${column.name}`}
              sx={{ maxWidth: '100%' }}
            />
          ))}
          {skipped.length === 0 && (
            <Typography variant="body2">
              Все исходные колонки используются.
            </Typography>
          )}
        </Stack>
      </Box>
      {!validation.valid && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Для продолжения выберите отдельную исходную колонку для каждого
          обязательного поля.
        </Alert>
      )}
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
        Предпросмотр сопоставления
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Первые {Math.min(20, table.rows.length)} из {table.totalRows} строк.
        Исходные значения без наценки и преобразований; артикулы сохраняются как
        текст.
      </Typography>
      <TableContainer sx={{ my: 2, maxHeight: 320 }}>
        <Table
          size="small"
          stickyHeader
          aria-label="Предпросмотр сопоставления"
        >
          <TableHead>
            <TableRow>
              <TableCell>Строка</TableCell>
              {productFields.map((field) => (
                <TableCell key={field.key}>{field.label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {table.rows.slice(0, 20).map((row, index) => {
              const mapped = mapSourceRow(row, mapping)
              return (
                <TableRow key={table.rowNumbers[index]}>
                  <TableCell>{table.rowNumbers[index]}</TableCell>
                  {productFields.map(({ key }) => (
                    <TableCell
                      key={key}
                      sx={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        maxWidth: 300,
                      }}
                    >
                      {mapped[key] === null ? (
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.secondary"
                        >
                          Не выбрано
                        </Typography>
                      ) : mapped[key] === '' ? (
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.secondary"
                        >
                          Пусто
                        </Typography>
                      ) : (
                        mapped[key]
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  )
}
