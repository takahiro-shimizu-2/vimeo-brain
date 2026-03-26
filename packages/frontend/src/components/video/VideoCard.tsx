import { Card, CardContent, Typography, Box, Chip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { IngestStatusBadge } from './IngestStatusBadge';
import type { Video } from '../../api/videos.api';

export function VideoCard({ video }: { video: Video }) {
  const navigate = useNavigate();
  return (
    <Card
      sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      onClick={() => navigate(`/videos/${video.id}`)}
    >
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} noWrap>
          {video.title || `Vimeo ${video.vimeo_id}`}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Chip label={`ID: ${video.vimeo_id}`} size="small" variant="outlined" />
          <IngestStatusBadge status={video.ingest_status} />
        </Box>
      </CardContent>
    </Card>
  );
}
