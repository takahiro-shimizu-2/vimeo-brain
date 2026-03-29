import { Box, Typography, Button, CircularProgress, Paper, Chip, Alert } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { sourcesApi, type Source, type IngestStatus, type SourceType } from '../api/sources.api';
import { IngestStatusBadge } from '../components/video/IngestStatusBadge';

function getSourceLabel(sourceType: SourceType): string {
  switch (sourceType) {
    case 'vimeo': return 'Vimeo';
    case 'youtube': return 'YouTube';
    case 'chatwork': return 'Chatwork';
    case 'text': return 'Text';
  }
}

function formatIngestError(msg: string): string {
  if (msg.includes('No transcript')) return 'Transcript not found. This source may not have transcripts available.';
  if (msg.includes('not found')) return 'Source not found. Please verify the ID.';
  if (msg.includes('rate limit') || msg.includes('429')) return 'API rate limit reached. Please try again later.';
  return msg;
}

export function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    sourcesApi.get(id).then(setSource).finally(() => setLoading(false));
    sourcesApi.ingestStatus(id).then(setIngestStatus).catch(() => {});
  }, [id]);

  const handleIngest = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await sourcesApi.ingest(id);
      setSource(prev => prev ? { ...prev, ingest_status: 'processing' } : prev);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start ingestion');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    await sourcesApi.remove(id);
    navigate('/sources');
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
  if (!source) return <Typography>Source not found</Typography>;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {source.title || `${getSourceLabel(source.source_type)} ${source.source_id}`}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
        <Chip label={getSourceLabel(source.source_type)} color="primary" variant="outlined" />
        <Chip label={`ID: ${source.source_id}`} variant="outlined" />
        <IngestStatusBadge status={source.ingest_status} />
      </Box>
      {source.description && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="body2" color="text.secondary">{source.description}</Typography>
        </Paper>
      )}
      {ingestStatus && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>Ingestion Details</Typography>
          <Typography variant="body2">Stage: {ingestStatus.last_completed_stage ?? '-'} / 7</Typography>
          {ingestStatus.error_message && (
            <Alert severity="error" sx={{ mt: 1 }}>{formatIngestError(ingestStatus.error_message)}</Alert>
          )}
        </Paper>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" onClick={handleIngest} disabled={source.ingest_status === 'processing'}>
          {source.ingest_status === 'completed' ? 'Re-ingest' : 'Start Ingest'}
        </Button>
        <Button variant="outlined" color="error" onClick={handleDelete}>Delete</Button>
        <Button variant="outlined" onClick={() => navigate('/sources')}>Back to Sources</Button>
      </Box>
    </Box>
  );
}
