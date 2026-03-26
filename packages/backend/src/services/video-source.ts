export interface VideoMetadata {
  title: string;
  description: string | null;
  duration_seconds: number;
  thumbnail_url: string | null;
}

export interface VideoSourceService {
  getMetadata(sourceId: string): Promise<VideoMetadata>;
  getTranscriptVtt(sourceId: string): Promise<string>;
}
