import { useState, useCallback } from 'react';
import { chatApi, type ChatMessage, type ChatResult } from '../api/chat.api';

export function useChat(initialSessionId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: sessionId || '',
      role: 'user',
      content: text,
      sources: null,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const result: ChatResult = await chatApi.send(text, sessionId);
      setSessionId(result.session_id);
      setMessages(prev => [...prev, result.message]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        session_id: sessionId || '',
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        sources: null,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadSession = useCallback(async (id: string) => {
    const session = await chatApi.getSession(id);
    setSessionId(id);
    setMessages(session.messages);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(undefined);
  }, []);

  return { messages, sessionId, loading, sendMessage, loadSession, clearChat };
}
