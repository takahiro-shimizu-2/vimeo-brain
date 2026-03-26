import type { GraphStore } from '../db/connection.js';
import type { KnowledgeNode } from '../schema/nodes.js';
import type { EmbedFn } from '../pipeline/embedding-generator.js';

export interface SearchResult {
  node: KnowledgeNode;
  score: number;
  source: 'bm25' | 'semantic' | 'hybrid';
}

export interface HybridSearchOptions {
  limit?: number;
  bm25Weight?: number;
  semanticWeight?: number;
}

const RRF_K = 60;

export async function hybridSearch(
  store: GraphStore,
  query: string,
  embedFn: EmbedFn,
  options: HybridSearchOptions = {}
): Promise<SearchResult[]> {
  const limit = options.limit || 10;
  const fetchLimit = limit * 3;

  const [bm25Results, queryEmbedding] = await Promise.all([
    store.fullTextSearch(query, fetchLimit),
    embedFn([query]),
  ]);

  const semanticResults = queryEmbedding[0]
    ? await store.semanticSearch(queryEmbedding[0], fetchLimit)
    : [];

  // RRF merge
  const scoreMap = new Map<string, { node: KnowledgeNode; bm25Rank: number; semanticRank: number }>();

  bm25Results.forEach((result, rank) => {
    scoreMap.set(result.id, {
      node: result,
      bm25Rank: rank + 1,
      semanticRank: fetchLimit + 1,
    });
  });

  semanticResults.forEach((result, rank) => {
    const existing = scoreMap.get(result.id);
    if (existing) {
      existing.semanticRank = rank + 1;
    } else {
      scoreMap.set(result.id, {
        node: result,
        bm25Rank: fetchLimit + 1,
        semanticRank: rank + 1,
      });
    }
  });

  const results: SearchResult[] = [];
  for (const [, entry] of scoreMap) {
    const bm25Score = 1 / (RRF_K + entry.bm25Rank);
    const semanticScore = 1 / (RRF_K + entry.semanticRank);
    const totalScore = bm25Score + semanticScore;

    results.push({
      node: entry.node,
      score: totalScore,
      source: 'hybrid',
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
