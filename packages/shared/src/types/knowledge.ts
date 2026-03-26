export interface KnowledgeSegment {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  content_hash: string;
  video_id: string;
  video_title: string;
}

export interface KnowledgeTopic {
  id: string;
  label: string;
  keywords: string[];
  description: string;
  cohesion: number;
  segment_count: number;
}

export interface KnowledgeConcept {
  id: string;
  name: string;
  type: string;
  description: string;
  mention_count: number;
}
