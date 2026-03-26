import { Box, Typography, Button, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useState } from 'react';
import { VideoList } from '../components/video/VideoList';
import { AddVideoDialog } from '../components/video/AddVideoDialog';
import { useVideos } from '../hooks/useVideos';

export function VideosPage() {
  const { videos, loading, addVideo } = useVideos();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Videos</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Add Video
        </Button>
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>
      ) : (
        <VideoList videos={videos} />
      )}
      <AddVideoDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={addVideo} />
    </Box>
  );
}
