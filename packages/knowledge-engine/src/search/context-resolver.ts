/**
 * Context Resolver — core search engine for vimeo-brain RAG.
 *
 * Implements the GitNexus stable-ops architecture:
 *   1. Japanese preprocessing (particle removal + bigram)
 *   2. Intent classification (factual / overview / who_what)
 *   3. FTS with 3-level fallback
 *   4. Optional semantic search
 *   5. DFS graph expansion with edge-weight decay
 *   6. Weighted hybrid scoring
 *   7. Token budget pruning
 */

import type { GraphStore } from '../db/connection.js';
import type { KnowledgeNode, KnowledgeNodeType } from '../schema/nodes.js';
import type { KnowledgeEdgeType } from '../schema/edges.js';
import type { EmbedFn } from '../pipeline/embedding-generator.js';
import { preprocessQuery, type PreprocessedQuery } from './japanese-preprocessor.js';
import { selectWithinBudget } from './token-budget.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryIntent = 'factual' | 'overview' | 'who_what';

export interface ResolveOptions {
  /** Token budget for the returned context (default: 4000) */
  maxTokens?: number;
  /** Max DFS expansion depth (default: 3) */
  maxDepth?: number;
  /** Explicit intent override — auto-classified if omitted */
  intent?: QueryIntent;
}

export interface ScoredNode {
  node: KnowledgeNode;
  score: number;
  source: 'bm25' | 'semantic' | 'graph';
  depth: number;
}

export interface ResolvedContext {
  nodes: ScoredNode[];
  intent: QueryIntent;
  totalTokens: number;
  prunedCount: number;
  fallbackLevel: number;
  query: PreprocessedQuery;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_MAX_DEPTH = 3;
const FTS_LIMIT = 20;
const PRUNE_THRESHOLD = 0.01;

/** Edge weights for DFS expansion decay */
const EDGE_WEIGHTS: Record<string, number> = {
  CONTAINS: 0.9,
  MENTIONS: 0.8,
  FOLLOWS: 0.7,
  PART_OF_TOPIC: 0.7,
  RELATES_TO: 0.6,
  STEP_IN_FLOW: 0.5,
  CROSS_REFS: 0.4,
  MEMBER_OF: 0.3,
};

/** Base type weights — higher = more relevant to RAG */
const BASE_TYPE_WEIGHTS: Record<KnowledgeNodeType, number> = {
  Segment: 1.0,
  Video: 0.9,
  Topic: 0.7,
  Concept: 0.5,
  NarrativeFlow: 0.3,
  Transcript: 0.2,
};

/** Intent-based adjustments per node type */
const INTENT_ADJUSTMENTS: Record<QueryIntent, Partial<Record<KnowledgeNodeType, number>>> = {
  factual: { Segment: 1.2, Video: 1.0, Topic: 0.8, Concept: 1.1, NarrativeFlow: 0.5, Transcript: 0.3 },
  overview: { Segment: 0.8, Video: 1.0, Topic: 1.3, Concept: 0.7, NarrativeFlow: 1.2, Transcript: 0.3 },
  who_what: { Segment: 1.1, Video: 1.0, Topic: 0.7, Concept: 1.3, NarrativeFlow: 0.5, Transcript: 0.3 },
};

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

/**
 * Rule-based intent classification — no LLM call required.
 *
 * Order matters: overview patterns (including compound ones like 「何について」)
 * are tested BEFORE who_what to avoid mis-classification.
 */
function classifyIntent(query: string): QueryIntent {
  const q = query.toLowerCase();

  // overview: compound patterns first, then single keywords
  if (/何について|まとめ|概要|全体|要約|overview|summary|について/.test(q)) return 'overview';

  // who_what: person / concept questions
  if (/誰|何|who|what|どういう|どんな/.test(q)) return 'who_what';

  // factual: default
  return 'factual';
}

// ---------------------------------------------------------------------------
// FTS with 3-level fallback
// ---------------------------------------------------------------------------

interface FtsResult {
  seeds: ScoredNode[];
  fallbackLevel: number;
}

async function ftsWithFallback(
  store: GraphStore,
  preprocessed: PreprocessedQuery,
): Promise<FtsResult> {
  // Level 0: plainto_tsquery with cleaned text
  const level0 = await store.fullTextSearch(preprocessed.tsqueryRaw, FTS_LIMIT);
  if (level0.length > 0) {
    logger.debug({ level: 0, count: level0.length }, 'FTS hit at level 0 (plainto)');
    return { seeds: toScoredNodes(level0, 'bm25'), fallbackLevel: 0 };
  }

  // Level 1: bigram AND query (CJK only)
  if (preprocessed.tsqueryBigram) {
    try {
      const level1 = await store.rawTsSearch(preprocessed.tsqueryBigram, FTS_LIMIT);
      if (level1.length > 0) {
        logger.debug({ level: 1, count: level1.length }, 'FTS hit at level 1 (bigram AND)');
        return { seeds: toScoredNodes(level1, 'bm25'), fallbackLevel: 1 };
      }
    } catch {
      logger.debug('FTS level 1 (bigram) query failed, falling through');
    }
  }

  // Level 2: token OR query
  if (preprocessed.tsqueryOr) {
    try {
      const level2 = await store.rawTsSearch(preprocessed.tsqueryOr, FTS_LIMIT);
      if (level2.length > 0) {
        logger.debug({ level: 2, count: level2.length }, 'FTS hit at level 2 (token OR)');
        return { seeds: toScoredNodes(level2, 'bm25'), fallbackLevel: 2 };
      }
    } catch {
      logger.debug('FTS level 2 (OR) query failed, falling through');
    }
  }

  // Level 3: recent segments — always returns something
  const level3 = await store.getRecentSegments(FTS_LIMIT);
  logger.debug({ level: 3, count: level3.length }, 'FTS fallback to recent segments');
  return {
    seeds: level3.map((node, i) => ({
      node,
      score: 1 - i / Math.max(level3.length, 1),
      source: 'bm25' as const,
      depth: 0,
    })),
    fallbackLevel: 3,
  };
}

/**
 * Convert FTS results (with rank) to ScoredNode[].
 * Normalises ranks so that rank=1 → score=1.0, rank=max → score≈0.0.
 */
function toScoredNodes(
  results: Array<KnowledgeNode & { rank: number }>,
  source: 'bm25' | 'semantic',
): ScoredNode[] {
  if (results.length === 0) return [];

  const maxRank = results.length;
  return results.map((r, idx) => ({
    node: r,
    // idx=0 (best) → 1.0, idx=max-1 (worst) → ~0.0
    score: maxRank <= 1 ? 1 : (maxRank - 1 - idx) / (maxRank - 1),
    source,
    depth: 0,
  }));
}

// ---------------------------------------------------------------------------
// DFS graph expansion
// ---------------------------------------------------------------------------

interface QueueItem {
  nodeId: string;
  score: number;
  depth: number;
}

async function expandFromSeeds(
  store: GraphStore,
  seeds: ScoredNode[],
  maxDepth: number,
): Promise<ScoredNode[]> {
  const visited = new Set<string>();
  const neighborNodeIds: string[] = [];
  const neighborEntries: Array<{ nodeId: string; score: number; depth: number }> = [];

  // Current BFS frontier: start with seed nodes
  let currentLevel: QueueItem[] = seeds.map((s) => ({
    nodeId: s.node.id,
    score: s.score,
    depth: 0,
  }));

  // BFS level-by-level with batched edge fetching
  while (currentLevel.length > 0) {
    // Mark current level as visited, collect those needing expansion
    const toExpand: QueueItem[] = [];
    for (const item of currentLevel) {
      if (visited.has(item.nodeId)) continue;
      visited.add(item.nodeId);

      if (item.depth > 0) {
        neighborNodeIds.push(item.nodeId);
        neighborEntries.push(item);
      }

      if (item.depth < maxDepth) {
        toExpand.push(item);
      }
    }

    if (toExpand.length === 0) break;

    // Batch fetch all edges for this level in a single query
    const expandIds = toExpand.map((item) => item.nodeId);
    const allEdges = await store.findEdgesBidirectionalBatch(expandIds);

    // Group edges by source/target node
    const edgesByNode = new Map<string, typeof allEdges>();
    for (const edge of allEdges) {
      for (const id of expandIds) {
        if (edge.source_id === id || edge.target_id === id) {
          const list = edgesByNode.get(id) ?? [];
          list.push(edge);
          edgesByNode.set(id, list);
        }
      }
    }

    // Build next level
    const nextLevel: QueueItem[] = [];
    for (const item of toExpand) {
      const edges = edgesByNode.get(item.nodeId) ?? [];
      for (const edge of edges) {
        const neighborId = edge.source_id === item.nodeId ? edge.target_id : edge.source_id;
        if (visited.has(neighborId)) continue;

        const edgeWeight = EDGE_WEIGHTS[edge.type] ?? 0.3;
        const neighborScore = (item.score * edgeWeight) / (item.depth + 1);
        if (neighborScore < PRUNE_THRESHOLD) continue;

        nextLevel.push({ nodeId: neighborId, score: neighborScore, depth: item.depth + 1 });
      }
    }

    currentLevel = nextLevel;
  }

  // Batch-fetch actual node data for all discovered neighbours
  if (neighborNodeIds.length === 0) return [];
  const nodeMap = new Map<string, KnowledgeNode>();
  const nodes = await store.findNodesByIds(neighborNodeIds);
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const results: ScoredNode[] = [];
  for (const entry of neighborEntries) {
    const node = nodeMap.get(entry.nodeId);
    if (node) {
      results.push({ node, score: entry.score, source: 'graph', depth: entry.depth });
    }
  }

  logger.debug({ expanded: results.length, visited: visited.size }, 'Graph expansion complete');
  return results;
}

// ---------------------------------------------------------------------------
// Hybrid scoring
// ---------------------------------------------------------------------------

function computeTypeWeight(nodeType: KnowledgeNodeType, intent: QueryIntent): number {
  const base = BASE_TYPE_WEIGHTS[nodeType] ?? 0.2;
  const adjustment = INTENT_ADJUSTMENTS[intent][nodeType] ?? 1.0;
  return base * adjustment;
}

function computeHybridScores(
  ftsNodes: ScoredNode[],
  graphNodes: ScoredNode[],
  semanticNodes: ScoredNode[],
  intent: QueryIntent,
  hasEmbeddings: boolean,
): ScoredNode[] {
  // Collect all nodes into a map keyed by node ID
  const merged = new Map<string, {
    node: KnowledgeNode;
    bm25Score: number;
    semanticScore: number;
    graphScore: number;
    bestSource: 'bm25' | 'semantic' | 'graph';
    depth: number;
  }>();

  for (const sn of ftsNodes) {
    merged.set(sn.node.id, {
      node: sn.node,
      bm25Score: sn.score,
      semanticScore: 0,
      graphScore: 0,
      bestSource: 'bm25',
      depth: 0,
    });
  }

  for (const sn of semanticNodes) {
    const existing = merged.get(sn.node.id);
    if (existing) {
      existing.semanticScore = sn.score;
      if (sn.score > existing.bm25Score) {
        existing.bestSource = 'semantic';
      }
    } else {
      merged.set(sn.node.id, {
        node: sn.node,
        bm25Score: 0,
        semanticScore: sn.score,
        graphScore: 0,
        bestSource: 'semantic',
        depth: 0,
      });
    }
  }

  for (const sn of graphNodes) {
    const existing = merged.get(sn.node.id);
    if (existing) {
      existing.graphScore = Math.max(existing.graphScore, sn.score);
    } else {
      merged.set(sn.node.id, {
        node: sn.node,
        bm25Score: 0,
        semanticScore: 0,
        graphScore: sn.score,
        bestSource: 'graph',
        depth: sn.depth,
      });
    }
  }

  // Compute hybrid scores
  const results: ScoredNode[] = [];
  for (const [, entry] of merged) {
    const typeWeight = computeTypeWeight(entry.node.type, intent);

    let hybridScore: number;
    if (hasEmbeddings) {
      // With embeddings: 0.4*max(BM25,Semantic) + 0.1*min(BM25,Semantic) + 0.3*Graph + 0.2*TypeWeight
      const primary = Math.max(entry.bm25Score, entry.semanticScore);
      const secondary = Math.min(entry.bm25Score, entry.semanticScore);
      hybridScore = 0.4 * primary + 0.1 * secondary + 0.3 * entry.graphScore + 0.2 * typeWeight;
    } else {
      // Without embeddings: 0.5*BM25 + 0.3*Graph + 0.2*TypeWeight
      hybridScore = 0.5 * entry.bm25Score + 0.3 * entry.graphScore + 0.2 * typeWeight;
    }

    results.push({
      node: entry.node,
      score: hybridScore,
      source: entry.bestSource,
      depth: entry.depth,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Resolve the most relevant knowledge context for a query.
 *
 * Orchestrates: Japanese preprocessing → intent classification →
 * multi-level FTS → optional semantic search → DFS graph expansion →
 * hybrid scoring → token budget pruning.
 *
 * @param store   - GraphStore instance (PostgreSQL connection)
 * @param query   - User query (Japanese or English)
 * @param embedFn - Embedding function; pass null to skip semantic search
 * @param options - Optional configuration
 */
export async function resolveContext(
  store: GraphStore,
  query: string,
  embedFn: EmbedFn | null,
  options?: ResolveOptions,
): Promise<ResolvedContext> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const preprocessed = preprocessQuery(query);
  const intent = options?.intent ?? classifyIntent(query);

  logger.debug({ query: preprocessed.original, intent, isCJK: preprocessed.isCJK }, 'Resolving context');

  // 1. FTS with 3-level fallback
  const { seeds, fallbackLevel } = await ftsWithFallback(store, preprocessed);

  // 2. Optional semantic search
  let semanticNodes: ScoredNode[] = [];
  if (embedFn) {
    try {
      const embeddings = await embedFn([preprocessed.original]);
      if (embeddings[0]) {
        const raw = await store.semanticSearch(embeddings[0], FTS_LIMIT);
        // semanticSearch returns distance (not rank), so assign rank by index order
        semanticNodes = toScoredNodes(
          raw.map((r, i) => ({ ...r, rank: i + 1 })),
          'semantic',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Semantic search failed, continuing with FTS only');
    }
  }

  // 3. DFS graph expansion from seeds
  const graphNodes = await expandFromSeeds(store, seeds, maxDepth);

  // 4. Hybrid scoring
  const hasEmbeddings = semanticNodes.length > 0;
  const scored = computeHybridScores(seeds, graphNodes, semanticNodes, intent, hasEmbeddings);

  // 5. Token budget
  const budget = selectWithinBudget(
    scored,
    (sn) => sn.node.text_content || sn.node.name || '',
    maxTokens,
  );

  logger.debug({
    resultCount: budget.selected.length,
    totalTokens: budget.totalTokens,
    prunedCount: budget.prunedCount,
    fallbackLevel,
    intent,
  }, 'Context resolved');

  return {
    nodes: budget.selected,
    intent,
    totalTokens: budget.totalTokens,
    prunedCount: budget.prunedCount,
    fallbackLevel,
    query: preprocessed,
  };
}
