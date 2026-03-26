import { useState, useEffect, useCallback } from 'react';
import { chatApi, type ChatSession } from '../api/chat.api';

export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await chatApi.getSessions();
      setSessions(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const deleteSession = useCallback(async (id: string) => {
    await chatApi.deleteSession(id);
    await refresh();
  }, [refresh]);

  return { sessions, loading, refresh, deleteSession };
}
