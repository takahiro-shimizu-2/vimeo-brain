import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { useState } from 'react';
import type { VideoSourceType } from '../../api/videos.api';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (sourceType: VideoSourceType, sourceId: string) => Promise<void>;
}

/** Extract a YouTube video ID from various URL formats, or return the input as-is. */
function extractYouTubeId(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtube.com') {
      // /watch?v=ID
      const v = url.searchParams.get('v');
      if (v) return v;
      // /embed/ID or /v/ID
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

export function AddVideoDialog({ open, onClose, onAdd }: Props) {
  const [sourceType, setSourceType] = useState<VideoSourceType>('youtube');
  const [sourceId, setSourceId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!sourceId.trim()) return;
    setLoading(true);
    try {
      const resolvedId = sourceType === 'youtube'
        ? extractYouTubeId(sourceId)
        : sourceId.trim();
      await onAdd(sourceType, resolvedId);
      setSourceId('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Video</DialogTitle>
      <DialogContent>
        <ToggleButtonGroup
          value={sourceType}
          exclusive
          onChange={(_, v: VideoSourceType | null) => { if (v) setSourceType(v); }}
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
          onChange={e => setSourceId(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={loading || !sourceId.trim()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
