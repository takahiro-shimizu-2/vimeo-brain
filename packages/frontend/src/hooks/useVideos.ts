import { useState, useEffect, useCallback } from 'react';
import { videosApi, type Video, type VideoSourceType } from '../api/videos.api';

export function useVideos() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await videosApi.list();
      setVideos(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addVideo = useCallback(async (sourceType: VideoSourceType, sourceId: string) => {
    await videosApi.create(sourceType, sourceId);
    await refresh();
  }, [refresh]);

  const removeVideo = useCallback(async (id: string) => {
    await videosApi.remove(id);
    await refresh();
  }, [refresh]);

  const startIngest = useCallback(async (id: string) => {
    await videosApi.ingest(id);
    await refresh();
  }, [refresh]);

  return { videos, loading, refresh, addVideo, removeVideo, startIngest };
}
