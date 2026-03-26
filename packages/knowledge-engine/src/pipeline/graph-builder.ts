import type { GraphStore } from '../db/connection.js';
import type { BuiltSegment } from './segment-builder.js';
import type { SegmentConcepts } from './concept-extractor.js';
import { logger } from '../utils/logger.js';

export interface GraphBuildResult {
  videoNodeId: string;
  transcriptNodeId: string;
  segmentNodeIds: string[];
  conceptNodeIds: string[];
}

export async function buildGraph(
  store: GraphStore,
  videoId: string,
  videoTitle: string,
  videoDescription: string | null,
  segments: BuiltSegment[],
  segmentConcepts: SegmentConcepts[],
  transcriptHash: string
): Promise<GraphBuildResult> {
  // 1. Create/find Video node
  let videoNode = await store.findNodeByHash(videoId);
  if (!videoNode) {
    videoNode = await store.addNode(
      'Video',
      videoTitle,
      videoDescription,
      { vimeo_id: videoId, description: videoDescription, duration_seconds: null },
      videoId
    );
  }

  // 2. Create Transcript node
  const transcriptNode = await store.addNode(
    'Transcript',
    `Transcript: ${videoTitle}`,
    null,
    { video_id: videoNode.id, language: 'auto', type: 'captions', segment_count: segments.length },
    transcriptHash
  );

  await store.addEdge(videoNode.id, transcriptNode.id, 'CONTAINS');

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
        video_id: videoNode.id,
        video_title: videoTitle,
      },
      seg.content_hash
    );
    segmentNodeIds.push(segNode.id);

    await store.addEdge(transcriptNode.id, segNode.id, 'CONTAINS', { sequence_index: seg.sequence_index });

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
    videoId: videoNode.id,
    segments: segmentNodeIds.length,
    concepts: conceptNodeIds.length,
  }, 'Graph built');

  return {
    videoNodeId: videoNode.id,
    transcriptNodeId: transcriptNode.id,
    segmentNodeIds,
    conceptNodeIds,
  };
}
