import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { GraphStore } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export interface DetectedCommunity {
  id: number;
  nodeIds: string[];
  segmentCount: number;
}

export async function detectCommunities(store: GraphStore): Promise<DetectedCommunity[]> {
  const segments = await store.findNodesByType('Segment');
  if (segments.length === 0) return [];

  const graph = new Graph({ type: 'undirected' });

  for (const seg of segments) {
    graph.addNode(seg.id, { type: 'Segment', name: seg.name });
  }

  // Build co-mention adjacency: two segments that mention the same concept
  const conceptToSegments = new Map<string, string[]>();
  for (const seg of segments) {
    const mentions = await store.findEdgesFrom(seg.id, 'MENTIONS');
    for (const edge of mentions) {
      const list = conceptToSegments.get(edge.target_id) || [];
      list.push(seg.id);
      conceptToSegments.set(edge.target_id, list);
    }
  }

  for (const [, segIds] of conceptToSegments) {
    for (let i = 0; i < segIds.length; i++) {
      for (let j = i + 1; j < segIds.length; j++) {
        if (graph.hasNode(segIds[i]) && graph.hasNode(segIds[j])) {
          const edgeKey = `${segIds[i]}-${segIds[j]}`;
          if (!graph.hasEdge(edgeKey)) {
            try {
              graph.addEdgeWithKey(edgeKey, segIds[i], segIds[j], { weight: 1 });
            } catch {
              // Edge may already exist in reverse
            }
          }
        }
      }
    }
  }

  // Also add FOLLOWS edges
  for (const seg of segments) {
    const follows = await store.findEdgesFrom(seg.id, 'FOLLOWS');
    for (const edge of follows) {
      if (graph.hasNode(edge.target_id)) {
        const edgeKey = `follows-${seg.id}-${edge.target_id}`;
        if (!graph.hasEdge(edgeKey)) {
          try {
            graph.addEdgeWithKey(edgeKey, seg.id, edge.target_id, { weight: 0.5 });
          } catch {
            // Edge may already exist
          }
        }
      }
    }
  }

  if (graph.size === 0) {
    return segments.map((seg, i) => ({
      id: i,
      nodeIds: [seg.id],
      segmentCount: 1,
    }));
  }

  const communities = louvain(graph);

  const communityMap = new Map<number, string[]>();
  for (const [nodeId, communityId] of Object.entries(communities)) {
    const list = communityMap.get(communityId) || [];
    list.push(nodeId);
    communityMap.set(communityId, list);
  }

  const result: DetectedCommunity[] = [];
  for (const [id, nodeIds] of communityMap) {
    result.push({ id, nodeIds, segmentCount: nodeIds.length });
  }

  logger.info({ communities: result.length, totalSegments: segments.length }, 'Communities detected');
  return result;
}

export async function storeCommunities(
  store: GraphStore,
  communities: DetectedCommunity[],
  segments: Array<{ id: string; text_content: string | null }>
): Promise<string[]> {
  const topicNodeIds: string[] = [];

  for (const community of communities) {
    const communitySegments = community.nodeIds
      .map(id => segments.find(s => s.id === id))
      .filter((s): s is { id: string; text_content: string | null } => s !== null);

    const combinedText = communitySegments
      .map(s => s.text_content || '')
      .join(' ');

    const keywords = extractKeywords(combinedText, 5);
    const label = keywords.slice(0, 3).join(', ') || `Topic ${community.id}`;

    const topicNode = await store.addNode(
      'Topic',
      label,
      `Topic covering ${community.segmentCount} segments`,
      {
        keywords,
        description: `Topic: ${label}`,
        cohesion: 0,
        segment_count: community.segmentCount,
      },
      null
    );

    topicNodeIds.push(topicNode.id);

    for (const segId of community.nodeIds) {
      await store.addEdge(segId, topicNode.id, 'PART_OF_TOPIC');
    }
  }

  return topicNodeIds;
}

function extractKeywords(text: string, count: number): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'nor', 'so', 'if', 'than', 'that', 'this', 'these',
    'those', 'it', 'its', 'he', 'she', 'they', 'them', 'we', 'you',
    'i', 'me', 'my', 'your', 'our', 'their', 'which', 'what', 'where',
    'when', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'only', 'very', 'just', 'also',
  ]);

  const words = text.toLowerCase().split(/\s+/).filter(w =>
    w.length > 2 && !stopWords.has(w) && /^[a-z\u3040-\u9fff]+$/i.test(w)
  );

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}
