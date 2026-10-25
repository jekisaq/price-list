import { useEffect, useState } from 'react'
import { ImportPanel } from './ImportPanel'
import { MappingPanel } from './MappingPanel'
import { ValidationReport } from './ValidationReport'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
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
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type {
  DraftMapping,
  ImportedTable,
  ProcessResult,
  Result,
  Settings,
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
  const [options, setOptions] = useState<Settings>({
    markup: 20,
    duplicatePolicy: 'manual',
    roundingMode: 'nearest',
    roundingStep: 0.01,
  })
  const [corrections, setCorrections] = useState<Record<number, string>>({})
  const [pendingCorrections, setPendingCorrections] = useState(false)
  const [result, setResult] = useState<ProcessResult>()
  const [confirmedResult, setConfirmedResult] = useState('')
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
          setOptions(settings)
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
    Number(markup) <= 1000 &&
    /^\d+(?:\.\d{1,2})?$/.test(markup)

  async function calculate() {
    if (!table || !mappingValidation.valid)
      throw new Error('Проверьте сопоставление обязательных полей.')

    const settings = { ...options, markup: Number(markup) }
    unwrap(await window.api.saveSettings(settings))
    const next = unwrap(
      await window.api.processTable({
        ...settings,
        importId: table.id,
        mapping: mappingValidation.mapping,
        corrections: Object.entries(corrections).map(([sourceRow, sku]) => ({
          sourceRow: Number(sourceRow),
          sku,
        })),
      }),
    )
    setConfirmedResult('')
    setResult(next)
    setPendingCorrections(false)
    setStep(2)
  }

  const correctionRows = new Map(
    Object.entries(corrections).map(([sourceRow, sku]) => [
      Number(sourceRow),
      { sourceRow: Number(sourceRow), sku, name: '' },
    ]),
  )
  for (const row of result?.duplicates ?? []) {
    correctionRows.set(row.sourceRow, row)
  }

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
              setCorrections({})
              setPendingCorrections(false)
              setTable(undefined)
              setResult(undefined)
              setNotice('')
              setError('')
            }}
            onImported={(imported) => {
              setCorrections({})
              setPendingCorrections(false)
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
                setCorrections({})
                setPendingCorrections(false)
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
                  ? 'Введите наценку от 0 до 1000%, до двух десятичных знаков.'
                  : 'Применяется на следующем шаге'
              }
              type="number"
              slotProps={{ htmlInput: { min: 0, max: 1000, step: 0.01 } }}
              value={markup}
              sx={{ maxWidth: 300, mt: 1 }}
              onChange={(event) => {
                setMarkup(event.target.value)
                setResult(undefined)
              }}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ mt: 2 }}
            >
              <TextField
                select
                label="Обработка дублей"
                value={options.duplicatePolicy ?? 'manual'}
                disabled={busy}
                slotProps={{ select: { native: true } }}
                onChange={(event) => {
                  setOptions({
                    ...options,
                    duplicatePolicy: event.target
                      .value as Settings['duplicatePolicy'],
                  })
                  setResult(undefined)
                }}
              >
                <option value="manual">Исправить вручную</option>
                <option value="first">Оставить первую строку</option>
                <option value="last">Оставить последнюю строку</option>
              </TextField>
              <TextField
                select
                label="Округление"
                value={options.roundingMode ?? 'nearest'}
                disabled={busy}
                slotProps={{ select: { native: true } }}
                onChange={(event) => {
                  setOptions({
                    ...options,
                    roundingMode: event.target
                      .value as Settings['roundingMode'],
                  })
                  setResult(undefined)
                }}
              >
                <option value="nearest">До ближайшего</option>
                <option value="up">Вверх</option>
                <option value="down">Вниз</option>
              </TextField>
              <TextField
                select
                label="Шаг округления"
                value={options.roundingStep ?? 0.01}
                disabled={busy}
                slotProps={{ select: { native: true } }}
                onChange={(event) => {
                  setOptions({
                    ...options,
                    roundingStep: Number(
                      event.target.value,
                    ) as Settings['roundingStep'],
                  })
                  setResult(undefined)
                }}
              >
                <option value="0.01">0,01</option>
                <option value="1">1</option>
                <option value="10">10</option>
              </TextField>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Дубли определяются по артикулу с учётом регистра. Пробелы по краям
              удаляются, повторные пробелы заменяются одним; ведущие нули
              сохраняются. Цена: от 0 до 1 000 000 000, например 1 234,56 или
              1234.56. Наценка всегда рассчитывается от импортированной цены.
              При округлении до ближайшего середина округляется вверх.
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
                  setStep(0)
                  setNotice('')
                  setError('')
                }}
              >
                Назад
              </Button>
              <Button
                disabled={busy || !mappingValidation.valid || !validMarkup}
                onClick={() => void run(calculate)}
              >
                Проверить и рассчитать
              </Button>
            </Stack>
          </>
        )}
        {step === 2 && result && (
          <>
            <ValidationReport
              key={result.id}
              result={result}
              busy={busy}
              stale={pendingCorrections}
              onExport={() =>
                void run(async () => {
                  const exported = unwrap(
                    await window.api.exportReport({ resultId: result.id }),
                  )
                  setNotice(
                    exported.canceled
                      ? 'Сохранение отчёта отменено. Можно попробовать снова.'
                      : `Отчёт сохранён: ${exported.path}`,
                  )
                })
              }
            />
            {result.excludedRows.length > 0 && (
              <Alert severity="warning">
                Исключены повторные строки: {result.excludedRows.join(', ')}.
              </Alert>
            )}
            {(options.duplicatePolicy ?? 'manual') === 'manual' &&
              correctionRows.size > 0 && (
                <Stack spacing={2} sx={{ my: 2 }}>
                  <Typography>
                    Исправьте артикулы повторяющихся товаров и пересчитайте
                    результат.
                  </Typography>
                  {[...correctionRows.values()].map((row) => (
                    <TextField
                      key={row.sourceRow}
                      label={`Артикул — строка ${row.sourceRow}`}
                      helperText={row.name}
                      disabled={busy}
                      value={corrections[row.sourceRow] ?? row.sku}
                      onChange={(event) => {
                        setCorrections({
                          ...corrections,
                          [row.sourceRow]: event.target.value,
                        })
                        setPendingCorrections(true)
                      }}
                    />
                  ))}
                  <Button disabled={busy} onClick={() => void run(calculate)}>
                    Пересчитать исправления
                  </Button>
                </Stack>
              )}
            {pendingCorrections && (
              <Alert severity="info">
                Предпросмотр устарел. Пересчитайте исправления.
              </Alert>
            )}

            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ flexWrap: 'wrap', mt: 3 }}
            >
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Изменить сопоставление
              </Button>
              <Button
                disabled={
                  busy ||
                  pendingCorrections ||
                  result.issues.some((issue) => issue.severity === 'error') ||
                  result.products.length === 0
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
              Товаров к экспорту: {result.products.length}. Формат CSV: артикул,
              наименование и цена с наценкой.
            </Typography>
            {result.excludedRows.length > 0 && (
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Alert severity="warning">
                  Исключены повторные строки: {result.excludedRows.join(', ')}.
                  Товаров в файле: {result.products.length}.
                </Alert>
                <FormControlLabel
                  control={
                    <Checkbox
                      disabled={busy}
                      checked={confirmedResult === result.id}
                      onChange={(event) =>
                        setConfirmedResult(
                          event.target.checked ? result.id : '',
                        )
                      }
                    />
                  }
                  label="Подтверждаю пропуск перечисленных строк"
                />
              </Stack>
            )}
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
                disabled={
                  busy ||
                  (result.excludedRows.length > 0 &&
                    confirmedResult !== result.id)
                }
                onClick={() =>
                  void run(async () => {
                    const exported = unwrap(
                      await window.api.exportTable({
                        resultId: result.id,
                        confirmExcluded: confirmedResult === result.id,
                      }),
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
