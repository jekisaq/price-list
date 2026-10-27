import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ProfilesState } from '../../shared/api'

interface Props {
  state: ProfilesState | undefined
  busy: boolean
  canSave: boolean
  onSelect: (id: string | null) => void
  onSave: (name: string, update: boolean) => void
  onRename: (name: string) => void
  onDelete: () => void
}

export function ProfilePanel({
  state,
  busy,
  canSave,
  onSelect,
  onSave,
  onRename,
  onDelete,
}: Props) {
  const selected = state?.profiles.find(
    (profile) => profile.id === state.activeProfileId,
  )
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    setName(selected?.name ?? '')
  }, [selected?.id, selected?.name])
  const disabled = busy || !state || state.readOnly
  const validName = name.trim().length > 0 && name.trim().length <= 80
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="h6">
          Профили поставщиков
        </Typography>
        {state?.warning && (
          <Alert severity="warning" sx={{ overflowWrap: 'anywhere' }}>
            {state.warning}
          </Alert>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Профиль поставщика"
            value={state?.activeProfileId ?? ''}
            disabled={disabled}
            slotProps={{
              select: { native: true },
              inputLabel: { shrink: true },
            }}
            onChange={(event) => onSelect(event.target.value || null)}
          >
            <option value="">Без профиля</option>
            {state?.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </TextField>
          <TextField
            label="Название профиля"
            value={name}
            disabled={disabled}
            slotProps={{ htmlInput: { maxLength: 80 } }}
            onChange={(event) => setName(event.target.value)}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Выбор профиля сбрасывает текущий импорт. Чтобы сохранить параметры и
          сопоставление, загрузите таблицу, настройте поля и нажмите «Сохранить
          как новый» или «Обновить профиль». Изменения профиля сохраняются этими
          кнопками; последняя наценка и правила расчёта сохраняются при
          обработке.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            disabled={disabled || !validName || !canSave}
            onClick={() => onSave(name, false)}
          >
            Сохранить как новый
          </Button>
          <Button
            variant="outlined"
            disabled={disabled || !selected || !validName || !canSave}
            onClick={() => onSave(name, true)}
          >
            Обновить профиль
          </Button>
          <Button
            disabled={
              disabled ||
              !selected ||
              !validName ||
              name.trim() === selected.name
            }
            onClick={() => onRename(name)}
          >
            Переименовать
          </Button>
          <Button
            color="error"
            disabled={disabled || !selected}
            onClick={() => setDeleting(true)}
          >
            Удалить профиль
          </Button>
        </Stack>
      </Stack>
      <Dialog open={deleting} onClose={() => setDeleting(false)}>
        <DialogTitle>Удалить профиль?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Профиль «{selected?.name}» будет удалён. Исходные таблицы и
            экспортированные файлы сохранятся.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)}>Отмена</Button>
          <Button
            color="error"
            onClick={() => {
              setDeleting(false)
              onDelete()
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
