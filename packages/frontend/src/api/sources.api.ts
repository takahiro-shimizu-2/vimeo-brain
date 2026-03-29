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

async function uploadFile(file: File, title?: string): Promise<Source> {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);

  const res = await fetch('/api/sources/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Upload failed');
  return json.data as Source;
}

export const sourcesApi = {
  list: () => api.get<Source[]>('/sources'),
  get: (id: string) => api.get<Source>(`/sources/${id}`),
  create: (sourceType: SourceType, sourceId: string) =>
    api.post<Source>('/sources', { source_type: sourceType, source_id: sourceId }),
  upload: uploadFile,
  remove: (id: string) => api.del(`/sources/${id}`),
  ingest: (id: string) => api.post<void>(`/sources/${id}/ingest`, {}),
  ingestStatus: (id: string) => api.get<IngestStatus>(`/sources/${id}/ingest/status`),
};
