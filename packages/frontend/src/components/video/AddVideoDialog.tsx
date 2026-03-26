import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, ToggleButtonGroup, ToggleButton, Alert,
} from '@mui/material';
import { useState } from 'react';
import type { VideoSourceType } from '../../api/videos.api';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (sourceType: VideoSourceType, sourceId: string) => Promise<void>;
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^\d{1,20}$/;

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
    // Not a valid URL — treat as raw ID
  }
  return trimmed;
}

function validateSourceId(sourceType: VideoSourceType, resolvedId: string): string | null {
  if (!resolvedId) return null;
  if (sourceType === 'youtube' && !YOUTUBE_ID_RE.test(resolvedId)) {
    return 'YouTube Video IDは11文字の英数字です。URLまたはIDを確認してください。';
  }
  if (sourceType === 'vimeo' && !VIMEO_ID_RE.test(resolvedId)) {
    return 'Vimeo Video IDは数字のみです。';
  }
  return null;
}

export function AddVideoDialog({ open, onClose, onAdd }: Props) {
  const [sourceType, setSourceType] = useState<VideoSourceType>('youtube');
  const [sourceId, setSourceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedId = sourceType === 'youtube' ? extractYouTubeId(sourceId) : sourceId.trim();
  const validationError = sourceId.trim() ? validateSourceId(sourceType, resolvedId) : null;

  const handleSubmit = async () => {
    if (!sourceId.trim() || validationError) return;
    setLoading(true);
    setError(null);
    try {
      await onAdd(sourceType, resolvedId);
      setSourceId('');
      setError(null);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '動画の追加に失敗しました';
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
      <DialogTitle>Add Video</DialogTitle>
      <DialogContent>
        <ToggleButtonGroup
          value={sourceType}
          exclusive
          onChange={(_, v: VideoSourceType | null) => { if (v) { setSourceType(v); setError(null); } }}
          size="small"
          sx={{ mt: 1, mb: 2 }}
        >
          <ToggleButton value="youtube">YouTube</ToggleButton>
          <ToggleButton value="vimeo">Vimeo</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          autoFocus
          fullWidth
          label={sourceType === 'youtube' ? 'YouTube URL or Video ID' : 'Vimeo Video ID'}
          placeholder={sourceType === 'youtube'
            ? 'https://youtube.com/watch?v=... or dQw4w9WgXcQ'
            : '123456789'}
          value={sourceId}
          onChange={e => { setSourceId(e.target.value); setError(null); }}
          error={!!validationError}
          helperText={validationError}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !sourceId.trim() || !!validationError}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
