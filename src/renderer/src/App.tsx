import { useEffect, useState } from 'react'
import { ImportPanel } from './ImportPanel'
import { MappingPanel } from './MappingPanel'
import { suggestMapping, validateMapping } from '../../shared/mapping'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type {
  DraftMapping,
  ImportedTable,
  ProcessResult,
  Result,
} from '../../shared/api'

const steps = ['Загрузка', 'Сопоставление', 'Проверка', 'Экспорт']
function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(result.error)

  return result.value
}

export function App() {
  const [step, setStep] = useState(0)
  const [table, setTable] = useState<ImportedTable>()
  const [mapping, setMapping] = useState<DraftMapping>({
    sku: null,
    name: null,
    price: null,
  })
  const [markup, setMarkup] = useState('20')
  const [result, setResult] = useState<ProcessResult>()
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    window.api
      .getSettings()
      .then((response) => {
        const settings = unwrap(response)

        if (active) {
          setMarkup(String(settings.markup))
          setReady(true)
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Не удалось загрузить настройки.',
          )

      })
    return () => {
      active = false
    }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Не удалось выполнить операцию.',
      )
    } finally {
      setBusy(false)
    }
  }

  const mappingValidation = validateMapping(mapping, table?.columns.length ?? 0)
  const validMarkup =
    markup.trim() !== '' &&
    Number.isFinite(Number(markup)) &&
    Number(markup) >= 0 &&
    Number(markup) <= 1000

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 5 } }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          color="primary"
          sx={{ letterSpacing: 2 }}
        >
          PRICE LIST
        </Typography>
        <Typography variant="h4" component="h1" gutterBottom>
          Подготовка прайс-листа
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          От таблицы поставщика до единого формата магазина.
        </Typography>
      </Box>
      <Alert severity="info" icon={false}>
        Импорт CSV/XLSX и подготовка прайса. Настройки наценки пока действуют
        только в текущем окне приложения.
      </Alert>
      <Stepper
        activeStep={step}
        alternativeLabel
        aria-label="Этапы подготовки"
        sx={{ my: 4 }}
      >
        {steps.map((label, index) => (
          <Step key={label} aria-current={step === index ? 'step' : undefined}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert
          severity="info"
          role="status"
          sx={{ mb: 2, overflowWrap: 'anywhere' }}
        >
          {notice}
        </Alert>
      )}
      <Paper
        component="section"
        variant="outlined"
        aria-busy={busy}
        sx={{ p: { xs: 2, sm: 3 } }}
      >
        <Typography component="h2" variant="h5" gutterBottom>
          {steps[step]}
        </Typography>
        <Box hidden={step !== 0}>
          <ImportPanel
            busy={busy}
            ready={ready}
            table={table}
            run={run}
            onReset={() => {
              setTable(undefined)
              setResult(undefined)
              setNotice('')
              setError('')
            }}
            onImported={(imported) => {
              setTable(imported)
              setResult(undefined)
              setMapping(suggestMapping(imported.columns))
            }}
            onNext={() => setStep(1)}
          />
        </Box>
        {step === 1 && table && (
          <>
            <MappingPanel
              table={table}
              mapping={mapping}
              busy={busy}
              onChange={(next) => {
                setMapping(next)
                setResult(undefined)
                setError('')
                setNotice('')
              }}
            />
            <TextField
              label="Наценка, %"
              disabled={busy}
              error={!validMarkup}
              helperText={
                !validMarkup
                  ? 'Введите наценку от 0 до 1000%.'
                  : 'Применяется на следующем шаге'
              }
              type="number"
              slotProps={{ htmlInput: { min: 0, max: 1000, step: 0.1 } }}
              value={markup}
              sx={{ maxWidth: 300, mt: 1 }}
              onChange={(event) => {
                setMarkup(event.target.value)
                setResult(undefined)
              }}
            />
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ flexWrap: 'wrap', mt: 3 }}
            >
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => {
                  setStep(0)
                  setNotice('')
                  setError('')
                }}
              >
                Назад
              </Button>
              <Button
                disabled={busy || !mappingValidation.valid || !validMarkup}
                onClick={() =>
                  void run(async () => {
                    if (!mappingValidation.valid)
                      throw new Error(
                        'Проверьте сопоставление обязательных полей.',
                      )

                    setResult(undefined)
                    unwrap(
                      await window.api.saveSettings({ markup: Number(markup) }),
                    )
                    setResult(
                      unwrap(
                        await window.api.processTable({
                          importId: table.id,
                          mapping: mappingValidation.mapping,
                          markup: Number(markup),
                        }),
                      ),
                    )
                    setStep(2)
                  })
                }
              >
                Проверить и рассчитать
              </Button>
            </Stack>
          </>
        )}
        {step === 2 && result && (
          <>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Готово товаров: {result.products.length}. Ошибок:{' '}
              {result.errors.length}.
            </Typography>
            {result.errors.length > 0 && (
              <Box component="ul" sx={{ color: 'error.main' }}>
                {result.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </Box>
            )}
            <TableContainer sx={{ my: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Артикул</TableCell>
                    <TableCell>Наименование</TableCell>
                    <TableCell>Цена с наценкой</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.products.map((product) => (
                    <TableRow key={product.sku}>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.price.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ flexWrap: 'wrap', mt: 3 }}
            >
              <Button variant="outlined" onClick={() => setStep(1)}>
                Изменить сопоставление
              </Button>
              <Button
                disabled={
                  result.errors.length > 0 || result.products.length === 0
                }
                onClick={() => setStep(3)}
              >
                Перейти к экспорту
              </Button>
            </Stack>
          </>
        )}
        {step === 3 && result && (
          <>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Сохраните {result.products.length} товара в CSV: артикул,
              наименование и цена с наценкой.
            </Typography>
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ flexWrap: 'wrap', mt: 3 }}
            >
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => {
                  setStep(2)
                  setNotice('')
                  setError('')
                }}
              >
                Назад
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const exported = unwrap(
                      await window.api.exportTable({ resultId: result.id }),
                    )
                    setNotice(
                      exported.canceled
                        ? 'Сохранение отменено. Можно попробовать снова.'
                        : `Файл сохранён: ${exported.path}`,
                    )
                  })
                }
              >
                Сохранить CSV…
              </Button>
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => {
                  setStep(0)
                  setTable(undefined)
                  setResult(undefined)
                  setNotice('')
                  setError('')
                }}
              >
                Новый импорт
              </Button>
            </Stack>
          </>
        )}
        {busy && (
          <Box role="status" sx={{ mt: 3 }}>
            <LinearProgress aria-label="Выполняется операция" />
            <Typography sx={{ mt: 1 }}>Выполняется операция…</Typography>
          </Box>
        )}
      </Paper>
    </Container>
  )
}
