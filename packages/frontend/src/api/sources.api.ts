import { api } from './client';

export type SourceType = 'vimeo' | 'youtube' | 'chatwork' | 'text';
export type ContentType = 'video' | 'chat' | 'document';

export interface Source {
  id: string;
  source_type: SourceType;
  source_id: string;
  content_type: ContentType;
  title: string;
  description: string | null;
  source_name: string | null;
  duration_seconds: number | null;
  ingest_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface IngestStatus {
  status: string;
  last_completed_stage: number | null;
  error_message: string | null;
}

export const sourcesApi = {
  list: () => api.get<Source[]>('/sources'),
  get: (id: string) => api.get<Source>(`/sources/${id}`),
  create: (sourceType: SourceType, sourceId: string) =>
    api.post<Source>('/sources', { source_type: sourceType, source_id: sourceId }),
  remove: (id: string) => api.del(`/sources/${id}`),
  ingest: (id: string) => api.post<void>(`/sources/${id}/ingest`, {}),
  ingestStatus: (id: string) => api.get<IngestStatus>(`/sources/${id}/ingest/status`),
};
