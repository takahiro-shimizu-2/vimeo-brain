import { Box, Typography, Button, CircularProgress, Paper, Chip } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { videosApi, type Video, type IngestStatus } from '../api/videos.api';
import { IngestStatusBadge } from '../components/video/IngestStatusBadge';

export function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    videosApi.get(id).then(setVideo).finally(() => setLoading(false));
    videosApi.ingestStatus(id).then(setIngestStatus).catch(() => {});
  }, [id]);

  const handleIngest = async () => {
    if (!id) return;
    await videosApi.ingest(id);
    setVideo(prev => prev ? { ...prev, ingest_status: 'processing' } : prev);
  };

  const handleDelete = async () => {
    if (!id) return;
    await videosApi.remove(id);
    navigate('/videos');
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
  if (!video) return <Typography>Video not found</Typography>;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {video.title || `${video.source_type === 'youtube' ? 'YouTube' : 'Vimeo'} ${video.source_id}`}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
        <Chip label={`${video.source_type === 'youtube' ? 'YouTube' : 'Vimeo'}: ${video.source_id}`} />
        <IngestStatusBadge status={video.ingest_status} />
      </Box>
      {video.description && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="body2" color="text.secondary">{video.description}</Typography>
        </Paper>
      )}
      {ingestStatus && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>Ingestion Details</Typography>
          <Typography variant="body2">Stage: {ingestStatus.last_completed_stage ?? '-'} / 7</Typography>
          {ingestStatus.error_message && (
            <Typography variant="body2" color="error">{ingestStatus.error_message}</Typography>
          )}
        </Paper>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={handleIngest} disabled={video.ingest_status === 'processing'}>
          {video.ingest_status === 'completed' ? 'Re-ingest' : 'Start Ingest'}
        </Button>
        <Button variant="outlined" color="error" onClick={handleDelete}>Delete</Button>
      </Box>
    </Box>
  );
}
