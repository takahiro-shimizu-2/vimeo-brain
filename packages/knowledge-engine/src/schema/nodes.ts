export type KnowledgeNodeType = 'Video' | 'Transcript' | 'Segment' | 'Topic' | 'Concept' | 'NarrativeFlow';

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  name: string;
  text_content: string | null;
  properties: Record<string, unknown>;
  content_hash: string | null;
  created_at: Date;
}

export interface VideoNodeProps {
  vimeo_id: string;
  description: string | null;
  duration_seconds: number | null;
}

export interface TranscriptNodeProps {
  video_id: string;
  language: string;
  type: string;
  segment_count: number;
}

export interface SegmentNodeProps {
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  video_id: string;
  video_title: string;
}

export interface TopicNodeProps {
  keywords: string[];
  description: string;
  cohesion: number;
  segment_count: number;
}

export interface ConceptNodeProps {
  concept_type: string;
  description: string;
  mention_count: number;
}

export interface NarrativeFlowNodeProps {
  flow_type: string;
  step_count: number;
  topics: string[];
}
