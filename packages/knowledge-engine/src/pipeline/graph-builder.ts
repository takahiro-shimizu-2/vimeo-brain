import type { GraphStore } from '../db/connection.js';
import type { KnowledgeNodeType } from '../schema/nodes.js';
import type { BuiltSegment } from './segment-builder.js';
import type { SegmentConcepts } from './concept-extractor.js';
import { logger } from '../utils/logger.js';

export interface GraphBuildResult {
  sourceNodeId: string;
  contentBodyNodeId: string;
  segmentNodeIds: string[];
  conceptNodeIds: string[];

  /** @deprecated Use sourceNodeId */
  videoNodeId: string;
  /** @deprecated Use contentBodyNodeId */
  transcriptNodeId: string;
}

export async function buildGraph(
  store: GraphStore,
  sourceId: string,
  sourceTitle: string,
  sourceDescription: string | null,
  sourceNodeType: KnowledgeNodeType = 'Video',
  segments: BuiltSegment[],
  segmentConcepts: SegmentConcepts[],
  contentHash: string
): Promise<GraphBuildResult> {
  // 1. Create/find Source node (Video / ChatRoom / Document)
  let sourceNode = await store.findNodeByHash(sourceId);
  if (!sourceNode) {
    sourceNode = await store.addNode(
      sourceNodeType,
      sourceTitle,
      sourceDescription,
      { source_id: sourceId, description: sourceDescription, duration_seconds: null, source_type: sourceNodeType },
      sourceId
    );
  }

  // 2. Create ContentBody node (replaces Transcript)
  const contentBodyNode = await store.addNode(
    'ContentBody',
    `Content: ${sourceTitle}`,
    null,
    { source_id: sourceNode.id, language: 'auto', type: 'captions', segment_count: segments.length },
    contentHash
  );

  await store.addEdge(sourceNode.id, contentBodyNode.id, 'CONTAINS');

  // 3. Create Segment nodes + CONTAINS + FOLLOWS edges
  const segmentNodeIds: string[] = [];
  let prevSegmentId: string | null = null;

  for (const seg of segments) {
    const existing = await store.findNodeByHash(seg.content_hash);
    if (existing) {
      segmentNodeIds.push(existing.id);
      if (prevSegmentId) {
        await store.addEdge(prevSegmentId, existing.id, 'FOLLOWS', { gap_ms: seg.start_ms });
      }
      prevSegmentId = existing.id;
      continue;
    }

    const segNode = await store.addNode(
      'Segment',
      `Seg ${seg.sequence_index}`,
      seg.text,
      {
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        sequence_index: seg.sequence_index,
        speaker: seg.speaker,
        source_id: sourceNode.id,
        source_title: sourceTitle,
      },
      seg.content_hash
    );
    segmentNodeIds.push(segNode.id);

    await store.addEdge(contentBodyNode.id, segNode.id, 'CONTAINS', { sequence_index: seg.sequence_index });

    if (prevSegmentId) {
      await store.addEdge(prevSegmentId, segNode.id, 'FOLLOWS');
    }
    prevSegmentId = segNode.id;
  }

  // 4. Create Concept nodes + MENTIONS edges
  const conceptMap = new Map<string, string>();
  const conceptNodeIds: string[] = [];

  for (const sc of segmentConcepts) {
    const segNodeId = segmentNodeIds[sc.segment_index];
    if (!segNodeId) continue;

    for (const concept of sc.concepts) {
      const key = concept.name.toLowerCase();
      let conceptNodeId = conceptMap.get(key);

      if (!conceptNodeId) {
        const conceptNode = await store.addNode(
          'Concept',
          concept.name,
          concept.description,
          { concept_type: concept.type, description: concept.description, mention_count: 1 },
          null
        );
        conceptNodeId = conceptNode.id;
        conceptMap.set(key, conceptNodeId);
        conceptNodeIds.push(conceptNodeId);
      } else {
        const existing = await store.findNodeById(conceptNodeId);
        if (existing) {
          const currentCount = (existing.properties as Record<string, unknown>).mention_count as number || 0;
          await store.updateNodeProperties(conceptNodeId, { mention_count: currentCount + 1 });
        }
      }

      await store.addEdge(segNodeId, conceptNodeId, 'MENTIONS');
    }
  }

  // 5. Create RELATES_TO edges between co-occurring concepts
  for (const sc of segmentConcepts) {
    const conceptNames = sc.concepts.map(c => c.name.toLowerCase());
    for (let i = 0; i < conceptNames.length; i++) {
      for (let j = i + 1; j < conceptNames.length; j++) {
        const idA = conceptMap.get(conceptNames[i]);
        const idB = conceptMap.get(conceptNames[j]);
        if (idA && idB) {
          await store.addEdge(idA, idB, 'RELATES_TO', { co_occurrence: true });
        }
      }
    }
  }

  logger.info({
    sourceNodeId: sourceNode.id,
    sourceNodeType,
    segments: segmentNodeIds.length,
    concepts: conceptNodeIds.length,
  }, 'Graph built');

  return {
    sourceNodeId: sourceNode.id,
    contentBodyNodeId: contentBodyNode.id,
    segmentNodeIds,
    conceptNodeIds,
    // deprecated aliases (same values)
    videoNodeId: sourceNode.id,
    transcriptNodeId: contentBodyNode.id,
  };
}
