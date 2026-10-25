import { createTheme } from '@mui/material/styles'
import { ruRU } from '@mui/material/locale'

export const theme = createTheme(
  {
    palette: {
      primary: { main: '#216c55' },
      background: { default: '#f5f7fa', paper: '#ffffff' },
      text: { primary: '#182536', secondary: '#526174' },
    },
    typography: {
      fontFamily: 'system-ui, sans-serif',
      h4: { fontWeight: 700 },
      h5: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiButton: {
        defaultProps: { variant: 'contained', disableElevation: true },
      },
      MuiTextField: { defaultProps: { fullWidth: true } },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 600, backgroundColor: '#f5f7fa' },
        },
      },
    },
  },
  ruRU,
)
