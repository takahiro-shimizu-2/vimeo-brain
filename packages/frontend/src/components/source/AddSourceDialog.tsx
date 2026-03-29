import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, ToggleButtonGroup, ToggleButton, Alert, Typography,
} from '@mui/material';
import { useState } from 'react';
import type { SourceType } from '../../api/sources.api';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (sourceType: SourceType, sourceId: string) => Promise<void>;
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^\d{1,20}$/;
const CHATWORK_ROOM_ID_RE = /^\d{1,20}$/;

/** Extract a YouTube video ID from various URL formats, or return the input as-is. */
function extractYouTubeId(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtube.com') {
      const v = url.searchParams.get('v');
      if (v) return v;
      const embedMatch = url.pathname.match(/^\/(?:embed|v)\/([^/?#]+)/);
      if (embedMatch) return embedMatch[1];
    }
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      if (id) return id;
    }
  } catch {
    // Not a valid URL -- treat as raw ID
  }
  return trimmed;
}

function validateSourceId(sourceType: SourceType, resolvedId: string): string | null {
  if (!resolvedId) return null;
  if (sourceType === 'youtube' && !YOUTUBE_ID_RE.test(resolvedId)) {
    return 'YouTube Video IDは11文字の英数字です。URLまたはIDを確認してください。';
  }
  if (sourceType === 'vimeo' && !VIMEO_ID_RE.test(resolvedId)) {
    return 'Vimeo Video IDは数字のみです。';
  }
  if (sourceType === 'chatwork' && !CHATWORK_ROOM_ID_RE.test(resolvedId)) {
    return 'Chatwork Room IDは数字のみです。';
  }
  return null;
}

function getLabel(sourceType: SourceType): string {
  switch (sourceType) {
    case 'youtube': return 'YouTube URL or Video ID';
    case 'vimeo': return 'Vimeo Video ID';
    case 'chatwork': return 'Chatwork Room ID';
    case 'text': return '';
  }
}

function getPlaceholder(sourceType: SourceType): string {
  switch (sourceType) {
    case 'youtube': return 'https://youtube.com/watch?v=... or dQw4w9WgXcQ';
    case 'vimeo': return '123456789';
    case 'chatwork': return '123456789';
    case 'text': return '';
  }
}

export function AddSourceDialog({ open, onClose, onAdd }: Props) {
  const [sourceType, setSourceType] = useState<SourceType>('youtube');
  const [sourceId, setSourceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedId = sourceType === 'youtube' ? extractYouTubeId(sourceId) : sourceId.trim();
  const validationError = sourceId.trim() ? validateSourceId(sourceType, resolvedId) : null;

  const isTextType = sourceType === 'text';

  const handleSubmit = async () => {
    if (isTextType || !sourceId.trim() || validationError) return;
    setLoading(true);
    setError(null);
    try {
      await onAdd(sourceType, resolvedId);
      setSourceId('');
      setError(null);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add source';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setSourceId('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Source</DialogTitle>
      <DialogContent>
        <ToggleButtonGroup
          value={sourceType}
          exclusive
          onChange={(_, v: SourceType | null) => {
            if (v) { setSourceType(v); setSourceId(''); setError(null); }
          }}
          size="small"
          sx={{ mt: 1, mb: 2 }}
        >
          <ToggleButton value="youtube">YouTube</ToggleButton>
          <ToggleButton value="vimeo">Vimeo</ToggleButton>
          <ToggleButton value="text">Text</ToggleButton>
          <ToggleButton value="chatwork">Chatwork</ToggleButton>
        </ToggleButtonGroup>

        {isTextType ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Text file upload will be available in a future release.
          </Typography>
        ) : (
          <TextField
            autoFocus
            fullWidth
            label={getLabel(sourceType)}
            placeholder={getPlaceholder(sourceType)}
            value={sourceId}
            onChange={e => { setSourceId(e.target.value); setError(null); }}
            error={!!validationError}
            helperText={validationError}
          />
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || isTextType || !sourceId.trim() || !!validationError}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
