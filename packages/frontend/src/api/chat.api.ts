import { api } from './client';

interface ChatSource {
  video_id: string;
  video_title: string;
  timestamp_ms: number;
  segment_text: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: ChatSource[] | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatResult {
  session_id: string;
  message: ChatMessage;
}

export const chatApi = {
  send: (message: string, sessionId?: string) =>
    api.post<ChatResult>('/chat', { message, session_id: sessionId }),
  getSessions: () => api.get<ChatSession[]>('/chat/sessions'),
  getSession: (id: string) => api.get<ChatSession & { messages: ChatMessage[] }>(`/chat/sessions/${id}`),
  deleteSession: (id: string) => api.del(`/chat/sessions/${id}`),
};
