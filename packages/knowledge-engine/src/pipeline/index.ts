import type { Pool } from 'pg';
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

export interface PipelineConfig {
  pool: Pool;
  llmFn: LlmExtractFn;
  embedFn: EmbedFn;
  startFromStage?: number;
}

export interface PipelineResult {
  videoNodeId: string;
  transcriptNodeId: string;
  segmentCount: number;
  conceptCount: number;
  topicCount: number;
  flowCount: number;
  embeddingCount: number;
  contentHash: string;
}

export type StageProgressFn = (stage: number, stageName: string) => Promise<void>;

export async function runPipeline(
  videoSourceId: string,
  videoTitle: string,
  videoDescription: string | null,
  vttContent: string,
  config: PipelineConfig,
  onProgress?: StageProgressFn
): Promise<PipelineResult> {
  const store = new GraphStore(config.pool);
  const startStage = config.startFromStage || 1;
  const transcriptHash = sha256(vttContent);

  // Check for duplicate transcript
  const existingTranscript = await store.findNodeByHash(transcriptHash);
  if (existingTranscript) {
    logger.info({ transcriptHash, videoSourceId }, 'Transcript already indexed, skipping');
    const edges = await store.findEdgesTo(existingTranscript.id, 'CONTAINS');
    const videoNodeId = edges[0]?.source_id || '';
    return {
      videoNodeId,
      transcriptNodeId: existingTranscript.id,
      segmentCount: 0,
      conceptCount: 0,
      topicCount: 0,
      flowCount: 0,
      embeddingCount: 0,
      contentHash: transcriptHash,
    };
  }

  let segments: ReturnType<typeof buildSegments> = [];
  let segmentConcepts: Awaited<ReturnType<typeof extractConcepts>> = [];
  let graphResult: Awaited<ReturnType<typeof buildGraph>> | null = null;
  let topicCount = 0;
  let flowCount = 0;
  let embeddingCount = 0;

  // Stage 1: VTT Parse
  if (startStage <= 1) {
    await onProgress?.(1, 'VTT Parse');
    logger.info({ videoSourceId }, 'Stage 1: VTT Parse');
  }
  const parsed = parseVtt(vttContent);

  // Stage 2: Segment Build
  if (startStage <= 2) {
    await onProgress?.(2, 'Segment Build');
    logger.info({ videoSourceId, cues: parsed.cues.length }, 'Stage 2: Segment Build');
  }
  segments = buildSegments(parsed.cues);

  // Stage 3: Concept Extract
  if (startStage <= 3) {
    await onProgress?.(3, 'Concept Extract');
    logger.info({ videoSourceId, segments: segments.length }, 'Stage 3: Concept Extract');
    segmentConcepts = await extractConcepts(
      segments.map((s, i) => ({ index: i, text: s.text })),
      config.llmFn
    );
  }

  // Stage 4: Graph Build
  if (startStage <= 4) {
    await onProgress?.(4, 'Graph Build');
    logger.info({ videoSourceId }, 'Stage 4: Graph Build');
    graphResult = await buildGraph(
      store,
      videoSourceId,
      videoTitle,
      videoDescription,
      segments,
      segmentConcepts,
      transcriptHash
    );
  }

  // Stage 5: Community Detect
  if (startStage <= 5) {
    await onProgress?.(5, 'Community Detect');
    logger.info({ videoSourceId }, 'Stage 5: Community Detect');
    const communities = await detectCommunities(store);
    const allSegments = await store.findNodesByType('Segment');
    const topicNodeIds = await storeCommunities(store, communities, allSegments);
    topicCount = topicNodeIds.length;
  }

  // Stage 6: Flow Detect
  if (startStage <= 6) {
    await onProgress?.(6, 'Flow Detect');
    logger.info({ videoSourceId }, 'Stage 6: Flow Detect');
    const flows = await detectFlows(store);
    const flowNodeIds = await storeFlows(store, flows);
    flowCount = flowNodeIds.length;
  }

  // Stage 7: Embedding Gen
  if (startStage <= 7) {
    await onProgress?.(7, 'Embedding Gen');
    logger.info({ videoSourceId }, 'Stage 7: Embedding Gen');
    embeddingCount = await generateEmbeddings(store, config.embedFn);
  }

  logger.info({
    videoSourceId,
    segments: segments.length,
    concepts: segmentConcepts.reduce((sum, sc) => sum + sc.concepts.length, 0),
    topics: topicCount,
    flows: flowCount,
    embeddings: embeddingCount,
  }, 'Pipeline complete');

  return {
    videoNodeId: graphResult?.videoNodeId || '',
    transcriptNodeId: graphResult?.transcriptNodeId || '',
    segmentCount: segments.length,
    conceptCount: graphResult?.conceptNodeIds.length || 0,
    topicCount,
    flowCount,
    embeddingCount,
    contentHash: transcriptHash,
  };
}
