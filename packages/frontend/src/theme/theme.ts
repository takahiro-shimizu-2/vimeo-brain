import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#6366f1' },
    secondary: { main: '#22d3ee' },
    background: { default: '#0f172a', paper: '#1e293b' },
  },
  typography: {
    fontFamily: '"Inter", "Noto Sans JP", sans-serif',
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: 'none' } } },
  },
});
