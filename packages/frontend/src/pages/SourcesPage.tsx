import { Box, Typography, Button, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useState } from 'react';
import { SourceList } from '../components/source/SourceList';
import { AddSourceDialog } from '../components/source/AddSourceDialog';
import { useSources } from '../hooks/useSources';

export function SourcesPage() {
  const { sources, loading, addSource } = useSources();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Sources</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Add Source
        </Button>
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
      ) : (
        <SourceList sources={sources} />
      )}
      <AddSourceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={addSource} />
    </Box>
  );
}
