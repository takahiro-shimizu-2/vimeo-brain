export type IngestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Video {
  id: string;
  vimeo_id: string;
  title: string;
  description: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  content_hash: string | null;
  ingest_status: IngestStatus;
  created_at: Date;
  updated_at: Date;
}

export interface IngestResult {
  video_id: string;
  status: IngestStatus;
  segment_count: number;
  content_hash: string;
  error_message?: string;
}
