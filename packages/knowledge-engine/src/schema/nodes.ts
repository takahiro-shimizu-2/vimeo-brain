export type KnowledgeNodeType =
  | 'Video' | 'ChatRoom' | 'Document'
  | 'Transcript' | 'ContentBody'
  | 'Segment' | 'Topic' | 'Concept' | 'NarrativeFlow';

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  name: string;
  text_content: string | null;
  properties: Record<string, unknown>;
  content_hash: string | null;
  created_at: Date;
}

export interface SourceNodeProps {
  source_id: string;
  description: string | null;
  duration_seconds: number | null;
  source_type: string;
}

/** @deprecated Use SourceNodeProps */
export type VideoNodeProps = SourceNodeProps;

export interface ContentBodyNodeProps {
  source_id: string;
  language: string;
  type: string;
  segment_count: number;
}

/** @deprecated Use ContentBodyNodeProps */
export type TranscriptNodeProps = ContentBodyNodeProps;

export interface SegmentNodeProps {
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  source_id: string;
  source_title: string;
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
