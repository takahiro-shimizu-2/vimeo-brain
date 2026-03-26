import { Box, Typography, Chip } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';

interface Source {
  video_title: string;
  timestamp_ms: number;
  segment_text: string;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export function SourceCard({ source }: { source: Source }) {
  return (
    <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', fontSize: '0.85rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <VideocamIcon sx={{ fontSize: 16 }} />
        <Typography variant="caption" fontWeight={600}>{source.video_title}</Typography>
        <Chip label={formatTime(source.timestamp_ms)} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {source.segment_text}
      </Typography>
    </Box>
  );
}
