// --- ContentSourceService Interface ---
// Replaces video-source.ts with a generalized content source abstraction.

export interface ContentSegment {
  text: string;
  start_ms: number;         // chat/text: 0
  end_ms: number;            // chat/text: 0
  sequence_index: number;
  speaker: string | null;    // chat: sender name
  metadata?: Record<string, unknown>;
}

export interface ContentFetchResult {
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;  // duration_seconds, thumbnail_url, etc.
  segments: ContentSegment[];
  rawContent: string;  // for hash computation
}

export interface ContentSourceService {
  fetchContent(sourceId: string): Promise<ContentFetchResult>;
}

// --- Backward-compatible interfaces (deprecated) ---

export interface VideoMetadata {
  title: string;
  description: string | null;
  duration_seconds: number;
  thumbnail_url: string | null;
}

/** @deprecated Use ContentSourceService instead */
export interface VideoSourceService {
  getMetadata(sourceId: string): Promise<VideoMetadata>;
  getTranscriptVtt(sourceId: string): Promise<string>;
}
