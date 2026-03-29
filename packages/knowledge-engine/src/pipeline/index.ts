import type { Pool } from 'pg';
import type { KnowledgeNodeType } from '../schema/nodes.js';
import { GraphStore } from '../db/connection.js';
import { parseVtt } from '../parsers/vtt-parser.js';
import { buildSegments } from './segment-builder.js';
import { extractConcepts, type LlmExtractFn } from './concept-extractor.js';
import { buildGraph } from './graph-builder.js';
import { detectCommunities, storeCommunities } from './community-detector.js';
import { detectFlows, storeFlows } from './flow-detector.js';
import { generateEmbeddings, type EmbedFn } from './embedding-generator.js';
import { sha256 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  pool: Pool;
  llmFn: LlmExtractFn;
  embedFn: EmbedFn;
  startFromStage?: number;
}

export interface PipelineResult {
  sourceNodeId: string;
  contentBodyNodeId: string;
  segmentCount: number;
  conceptCount: number;
  topicCount: number;
  flowCount: number;
  embeddingCount: number;
  contentHash: string;

  /** @deprecated Use sourceNodeId */
  videoNodeId: string;
  /** @deprecated Use contentBodyNodeId */
  transcriptNodeId: string;
}

/** Represents a pre-built content segment for the generic pipeline entry point. */
export interface ContentSegment {
  text: string;
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
}

export type StageProgressFn = (stage: number, stageName: string) => Promise<void>;

// ---------------------------------------------------------------------------
// runPipelineFromSegments — generic entry point (Stage 3+)
// ---------------------------------------------------------------------------

/**
 * Run the knowledge pipeline starting from pre-built segments.
 *
 * Skips Stage 1 (VTT Parse) and Stage 2 (Segment Build) since segments
 * are already provided. Starts directly from Stage 3 (Concept Extract).
 *
 * This is the preferred entry point for non-video content sources
 * (chat logs, text documents, etc.).
 */
export async function runPipelineFromSegments(
  sourceId: string,
  sourceTitle: string,
  sourceDescription: string | null,
  sourceNodeType: KnowledgeNodeType,
  segments: ContentSegment[],
  contentHash: string,
  config: PipelineConfig,
  onProgress?: StageProgressFn
): Promise<PipelineResult> {
  const store = new GraphStore(config.pool);

  // Check for duplicate content
  const existingContent = await store.findNodeByHash(contentHash);
  if (existingContent) {
    logger.info({ contentHash, sourceId }, 'Content already indexed, skipping');
    const edges = await store.findEdgesTo(existingContent.id, 'CONTAINS');
    const sourceNodeId = edges[0]?.source_id || '';
    return {
      sourceNodeId,
      contentBodyNodeId: existingContent.id,
      segmentCount: 0,
      conceptCount: 0,
      topicCount: 0,
      flowCount: 0,
      embeddingCount: 0,
      contentHash,
      // deprecated aliases
      videoNodeId: sourceNodeId,
      transcriptNodeId: existingContent.id,
    };
  }

  // Convert ContentSegment[] to BuiltSegment[] (add content_hash)
  const builtSegments = segments.map(s => ({
    text: s.text,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    sequence_index: s.sequence_index,
    speaker: s.speaker,
    content_hash: sha256(s.text),
  }));

  let topicCount = 0;
  let flowCount = 0;
  let embeddingCount = 0;

  // Stage 3: Concept Extract
  await onProgress?.(3, 'Concept Extract');
  logger.info({ sourceId, segments: builtSegments.length }, 'Stage 3: Concept Extract');
  const segmentConcepts = await extractConcepts(
    builtSegments.map((s, i) => ({ index: i, text: s.text })),
    config.llmFn
  );

  // Stage 4: Graph Build
  await onProgress?.(4, 'Graph Build');
  logger.info({ sourceId, sourceNodeType }, 'Stage 4: Graph Build');
  const graphResult = await buildGraph(
    store,
    sourceId,
    sourceTitle,
    sourceDescription,
    sourceNodeType,
    builtSegments,
    segmentConcepts,
    contentHash
  );

  // Stage 5: Community Detect
  await onProgress?.(5, 'Community Detect');
  logger.info({ sourceId }, 'Stage 5: Community Detect');
  const communities = await detectCommunities(store);
  const allSegments = await store.findNodesByType('Segment');
  const topicNodeIds = await storeCommunities(store, communities, allSegments);
  topicCount = topicNodeIds.length;

  // Stage 6: Flow Detect
  await onProgress?.(6, 'Flow Detect');
  logger.info({ sourceId }, 'Stage 6: Flow Detect');
  const flows = await detectFlows(store);
  const flowNodeIds = await storeFlows(store, flows);
  flowCount = flowNodeIds.length;

  // Stage 7: Embedding Gen
  await onProgress?.(7, 'Embedding Gen');
  logger.info({ sourceId }, 'Stage 7: Embedding Gen');
  embeddingCount = await generateEmbeddings(store, config.embedFn);

  logger.info({
    sourceId,
    sourceNodeType,
    segments: builtSegments.length,
    concepts: segmentConcepts.reduce((sum, sc) => sum + sc.concepts.length, 0),
    topics: topicCount,
    flows: flowCount,
    embeddings: embeddingCount,
  }, 'Pipeline complete');

  const result: PipelineResult = {
    sourceNodeId: graphResult.sourceNodeId,
    contentBodyNodeId: graphResult.contentBodyNodeId,
    segmentCount: builtSegments.length,
    conceptCount: graphResult.conceptNodeIds.length,
    topicCount,
    flowCount,
    embeddingCount,
    contentHash,
    // deprecated aliases (same values)
    videoNodeId: graphResult.sourceNodeId,
    transcriptNodeId: graphResult.contentBodyNodeId,
  };

  return result;
}

// ---------------------------------------------------------------------------
// runPipeline — backward-compatible wrapper (VTT-based, all 7 stages)
// ---------------------------------------------------------------------------

/**
 * Run the full knowledge pipeline from raw VTT content.
 *
 * This is the original entry point preserved for backward compatibility.
 * Internally parses VTT, builds segments, then delegates to
 * runPipelineFromSegments with sourceNodeType='Video'.
 */
export async function runPipeline(
  videoSourceId: string,
  videoTitle: string,
  videoDescription: string | null,
  vttContent: string,
  config: PipelineConfig,
  onProgress?: StageProgressFn
): Promise<PipelineResult> {
  // Stage 1: VTT Parse
  await onProgress?.(1, 'VTT Parse');
  logger.info({ videoSourceId }, 'Stage 1: VTT Parse');
  const parsed = parseVtt(vttContent);

  // Stage 2: Segment Build
  await onProgress?.(2, 'Segment Build');
  logger.info({ videoSourceId, cues: parsed.cues.length }, 'Stage 2: Segment Build');
  const segments = buildSegments(parsed.cues);

  // Delegate to generic pipeline (Stage 3+)
  return runPipelineFromSegments(
    videoSourceId,
    videoTitle,
    videoDescription,
    'Video',
    segments.map(s => ({
      text: s.text,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      sequence_index: s.sequence_index,
      speaker: s.speaker,
    })),
    sha256(vttContent),
    config,
    onProgress
  );
}
