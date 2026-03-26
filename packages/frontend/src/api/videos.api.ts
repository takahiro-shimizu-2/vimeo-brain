import { api } from './client';

export interface Video {
  id: string;
  vimeo_id: string;
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
  create: (vimeoId: string) => api.post<Video>('/videos', { vimeo_id: vimeoId }),
  remove: (id: string) => api.del(`/videos/${id}`),
  ingest: (id: string) => api.post<void>(`/videos/${id}/ingest`, {}),
  ingestStatus: (id: string) => api.get<IngestStatus>(`/videos/${id}/ingest/status`),
};
