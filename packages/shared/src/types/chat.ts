export type MessageRole = 'user' | 'assistant';

export interface ChatSource {
  video_id: string;
  video_title: string;
  timestamp_ms: number;
  segment_text: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  sources: ChatSource[] | null;
  created_at: Date;
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChatRequest {
  session_id?: string;
  message: string;
}

export interface ChatResponse {
  session_id: string;
  message: ChatMessage;
}
