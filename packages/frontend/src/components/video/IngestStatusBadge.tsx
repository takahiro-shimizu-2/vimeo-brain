import { Chip } from '@mui/material';

const STATUS_MAP: Record<string, { label: string; color: 'default' | 'warning' | 'success' | 'error' }> = {
  pending: { label: 'Pending', color: 'default' },
  processing: { label: 'Processing', color: 'warning' },
  completed: { label: 'Completed', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
};

export function IngestStatusBadge({ status }: { status: string }) {
  const config = STATUS_MAP[status] || STATUS_MAP.pending;
  return <Chip label={config.label} color={config.color} size="small" />;
}
