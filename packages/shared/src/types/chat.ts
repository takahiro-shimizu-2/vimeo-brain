export type MessageRole = 'user' | 'assistant';

export interface ChatSource {
  source_id: string;       // was video_id
  source_title: string;    // was video_title
  source_type: string;
  timestamp_ms: number;    // chat/text: 0
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
