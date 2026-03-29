import type { IngestStatus } from './content-source.js';

export interface IngestLog {
  id: string;
  source_id: string;       // was video_id
  content_hash: string;
  segment_count: number;
  status: IngestStatus;
  last_completed_stage: number | null;
  stage_details: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
