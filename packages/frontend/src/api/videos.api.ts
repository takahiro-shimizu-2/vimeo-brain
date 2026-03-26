import { api } from './client';

export type VideoSourceType = 'vimeo' | 'youtube';

export interface Video {
  id: string;
  source_type: VideoSourceType;
  source_id: string;
  title: string;
  description: string | null;
  duration_seconds: number | null;
  ingest_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface IngestStatus {
  status: string;
  last_completed_stage: number | null;
  error_message: string | null;
}

export const videosApi = {
  list: () => api.get<Video[]>('/videos'),
  get: (id: string) => api.get<Video>(`/videos/${id}`),
  create: (sourceType: VideoSourceType, sourceId: string) =>
    api.post<Video>('/videos', { source_type: sourceType, source_id: sourceId }),
  remove: (id: string) => api.del(`/videos/${id}`),
  ingest: (id: string) => api.post<void>(`/videos/${id}/ingest`, {}),
  ingestStatus: (id: string) => api.get<IngestStatus>(`/videos/${id}/ingest/status`),
};
