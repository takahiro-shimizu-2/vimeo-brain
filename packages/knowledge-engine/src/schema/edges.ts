export type KnowledgeEdgeType =
  | 'CONTAINS'
  | 'FOLLOWS'
  | 'MENTIONS'
  | 'RELATES_TO'
  | 'PART_OF_TOPIC'
  | 'MEMBER_OF'
  | 'STEP_IN_FLOW'
  | 'CROSS_REFS';

export interface KnowledgeEdge {
  id: string;
  source_id: string;
  target_id: string;
  type: KnowledgeEdgeType;
  properties: Record<string, unknown>;
  created_at: Date;
}
