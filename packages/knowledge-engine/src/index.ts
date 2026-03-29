export { GraphStore } from './db/connection.js';
export { parseVtt, type VttCue, type ParsedVtt } from './parsers/vtt-parser.js';
export { buildSegments, type BuiltSegment } from './pipeline/segment-builder.js';
export { extractConcepts, type LlmExtractFn, type ExtractedConcept, type SegmentConcepts } from './pipeline/concept-extractor.js';
export { buildGraph, type GraphBuildResult } from './pipeline/graph-builder.js';
export { detectCommunities, storeCommunities, type DetectedCommunity } from './pipeline/community-detector.js';
export { detectFlows, storeFlows, type DetectedFlow } from './pipeline/flow-detector.js';
export { generateEmbeddings, type EmbedFn } from './pipeline/embedding-generator.js';
export { runPipeline, runPipelineFromSegments, type PipelineConfig, type PipelineResult, type ContentSegment, type StageProgressFn } from './pipeline/index.js';
export { hybridSearch, type SearchResult, type HybridSearchOptions } from './search/hybrid-search.js';
export { preprocessQuery, isCJKText, type PreprocessedQuery } from './search/japanese-preprocessor.js';
export { estimateTokens, selectWithinBudget, type BudgetResult } from './search/token-budget.js';
export {
  resolveContext,
  type ResolveOptions,
  type ResolvedContext,
  type ScoredNode,
  type QueryIntent,
} from './search/context-resolver.js';
export { sha256 } from './utils/hash.js';

export type { KnowledgeNode, KnowledgeNodeType, SourceNodeProps, ContentBodyNodeProps, VideoNodeProps, TranscriptNodeProps, SegmentNodeProps, TopicNodeProps, ConceptNodeProps, NarrativeFlowNodeProps } from './schema/nodes.js';
export type { KnowledgeEdge, KnowledgeEdgeType } from './schema/edges.js';
