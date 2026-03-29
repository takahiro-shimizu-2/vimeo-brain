// --- Source & Content Types ---

export type ContentType = 'video' | 'chat' | 'document';
export type SourceType = 'vimeo' | 'youtube' | 'chatwork' | 'text';

export interface ContentSource {
  id: string;
  source_type: SourceType;
  source_id: string;
  content_type: ContentType;
  title: string;
  description: string | null;
  source_name: string | null;       // "Chatwork Room X" etc.
  duration_seconds: number | null;  // video only
  thumbnail_url: string | null;     // video only
  content_hash: string | null;
  ingest_status: IngestStatus;
  created_at: Date;
  updated_at: Date;
}

export type IngestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IngestResult {
  source_id: string;
  status: IngestStatus;
  segment_count: number;
  content_hash: string;
  error_message?: string;
}

// --- Source Type -> Content Type Mapping ---

export const SOURCE_CONTENT_TYPE_MAP: Record<SourceType, ContentType> = {
  vimeo: 'video',
  youtube: 'video',
  chatwork: 'chat',
  text: 'document',
};

// --- Display helpers ---

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  vimeo: 'Vimeo',
  youtube: 'YouTube',
  chatwork: 'Chatwork',
  text: 'テキスト',
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  video: '動画',
  chat: 'チャット',
  document: 'ドキュメント',
};
