import { Box, Typography, Chip } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import ChatIcon from '@mui/icons-material/Chat';
import DescriptionIcon from '@mui/icons-material/Description';

interface Source {
  source_title?: string;
  video_title?: string;
  source_type?: string;
  timestamp_ms: number;
  segment_text: string;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function getSourceIcon(sourceType: string) {
  switch (sourceType) {
    case 'chatwork':
      return <ChatIcon sx={{ fontSize: 16 }} />;
    case 'text':
      return <DescriptionIcon sx={{ fontSize: 16 }} />;
    default:
      return <VideocamIcon sx={{ fontSize: 16 }} />;
  }
}

export function SourceCard({ source }: { source: Source }) {
  const title = source.source_title || source.video_title || 'Unknown';
  const sourceType = source.source_type ?? 'video';
  const showTimestamp = source.timestamp_ms > 0;

  return (
    <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', fontSize: '0.85rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        {getSourceIcon(sourceType)}
        <Typography variant="caption" fontWeight={600}>{title}</Typography>
        {showTimestamp && (
          <Chip label={formatTime(source.timestamp_ms)} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {source.segment_text}
      </Typography>
    </Box>
  );
}
