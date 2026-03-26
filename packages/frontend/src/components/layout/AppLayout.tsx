import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';

const DRAWER_WIDTH = 280;

export function AppLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Sidebar onNavigate={() => isMobile && setMobileOpen(false)} />
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
        {children}
      </Box>
    </Box>
  );
}
