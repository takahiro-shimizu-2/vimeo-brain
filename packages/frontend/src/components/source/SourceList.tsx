import { Grid2 as Grid } from '@mui/material';
import { SourceCard } from './SourceCard';
import type { Source } from '../../api/sources.api';

export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <Grid container spacing={2}>
      {sources.map(s => (
        <Grid key={s.id} size={{ xs: 12, sm: 6, md: 4 }}>
          <SourceCard source={s} />
        </Grid>
      ))}
    </Grid>
  );
}
