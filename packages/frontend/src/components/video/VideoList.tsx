import { Grid2 as Grid } from '@mui/material';
import { VideoCard } from './VideoCard';
import type { Video } from '../../api/videos.api';

export function VideoList({ videos }: { videos: Video[] }) {
  return (
    <Grid container spacing={2}>
      {videos.map(v => (
        <Grid key={v.id} size={{ xs: 12, sm: 6, md: 4 }}>
          <VideoCard video={v} />
        </Grid>
      ))}
    </Grid>
  );
}
