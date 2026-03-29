import { Card, CardContent, Typography, Box, Chip } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import ChatIcon from '@mui/icons-material/Chat';
import DescriptionIcon from '@mui/icons-material/Description';
import { useNavigate } from 'react-router-dom';
import { IngestStatusBadge } from '../video/IngestStatusBadge';
import type { Source, ContentType, SourceType } from '../../api/sources.api';

function getContentIcon(contentType: ContentType) {
  switch (contentType) {
    case 'video': return <VideocamIcon sx={{ fontSize: 18, mr: 0.5 }} />;
    case 'chat': return <ChatIcon sx={{ fontSize: 18, mr: 0.5 }} />;
    case 'document': return <DescriptionIcon sx={{ fontSize: 18, mr: 0.5 }} />;
  }
}

function getSourceLabel(sourceType: SourceType): string {
  switch (sourceType) {
    case 'vimeo': return 'Vimeo';
    case 'youtube': return 'YouTube';
    case 'chatwork': return 'Chatwork';
    case 'text': return 'Text';
  }
}

export function SourceCard({ source }: { source: Source }) {
  const navigate = useNavigate();
  return (
    <Card
      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      onClick={() => navigate(`/sources/${source.id}`)}
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          {getContentIcon(source.content_type)}
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            {source.title || `${getSourceLabel(source.source_type)} ${source.source_id}`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Chip
            label={`${getSourceLabel(source.source_type)}: ${source.source_id}`}
            size="small"
            variant="outlined"
          />
          <IngestStatusBadge status={source.ingest_status} />
        </Box>
      </CardContent>
    </Card>
  );
}
