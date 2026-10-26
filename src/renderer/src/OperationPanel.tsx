import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { OperationProgress } from '../../shared/api'

export function OperationPanel({
  progress,
  onCancel,
}: {
  progress: OperationProgress | undefined
  onCancel: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    setConfirming(false)
  }, [progress?.id])
  if (!progress)
    return null

  return (
    <>
      <Alert severity="info" icon={false} sx={{ my: 2 }}>
        <Stack spacing={1} role="status" aria-label="Прогресс операции">
          <Typography>
            {progress.stage} · Строк: {progress.processedRows}
            {progress.totalRows === null ? '' : ` из ${progress.totalRows}`}
            {progress.percent === null ? '' : ` · ${progress.percent}%`}
          </Typography>
          <LinearProgress
            variant={
              progress.percent === null ? 'indeterminate' : 'determinate'
            }
            value={progress.percent ?? undefined}
            aria-label="Выполняется операция"
          />
          <Button
            disabled={!progress.cancellable}
            onClick={() => setConfirming(true)}
          >
            Отменить операцию
          </Button>
        </Stack>
      </Alert>
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Остановить операцию?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Незавершённый результат будет отброшен. После остановки можно
            повторить операцию.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Продолжить</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirming(false)
              onCancel(progress.id)
            }}
          >
            Остановить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
