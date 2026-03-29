import { useState, useEffect, useCallback } from 'react';
import { sourcesApi, type Source, type SourceType } from '../api/sources.api';

export function useSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sourcesApi.list();
      setSources(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addSource = useCallback(async (sourceType: SourceType, sourceId: string) => {
    setError(null);
    try {
      await sourcesApi.create(sourceType, sourceId);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add source';
      setError(msg);
      throw err;
    }
  }, [refresh]);

  const removeSource = useCallback(async (id: string) => {
    await sourcesApi.remove(id);
    await refresh();
  }, [refresh]);

  const startIngest = useCallback(async (id: string) => {
    await sourcesApi.ingest(id);
    await refresh();
  }, [refresh]);

  return { sources, loading, error, refresh, addSource, removeSource, startIngest };
}
