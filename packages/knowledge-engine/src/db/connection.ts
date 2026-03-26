import { Pool } from 'pg';
import type { KnowledgeNode, KnowledgeNodeType } from '../schema/nodes.js';
import type { KnowledgeEdge, KnowledgeEdgeType } from '../schema/edges.js';
import { logger } from '../utils/logger.js';

export class GraphStore {
  private pool: Pool;

  constructor(poolOrConfig: Pool | string) {
    if (typeof poolOrConfig === 'string') {
      this.pool = new Pool({ connectionString: poolOrConfig });
    } else {
      this.pool = poolOrConfig;
    }
  }

  async addNode(
    type: KnowledgeNodeType,
    name: string,
    textContent: string | null,
    properties: Record<string, unknown>,
    contentHash: string | null = null
  ): Promise<KnowledgeNode> {
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_nodes (type, name, text_content, properties, content_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [type, name, textContent, JSON.stringify(properties), contentHash]
    );
    return rows[0] as KnowledgeNode;
  }

  async addEdge(
    sourceId: string,
    targetId: string,
    type: KnowledgeEdgeType,
    properties: Record<string, unknown> = {}
  ): Promise<KnowledgeEdge> {
    const { rows } = await this.pool.query(
      `INSERT INTO knowledge_edges (source_id, target_id, type, properties)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sourceId, targetId, type, JSON.stringify(properties)]
    );
    return rows[0] as KnowledgeEdge;
  }

  async findNodeByHash(contentHash: string): Promise<KnowledgeNode | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_nodes WHERE content_hash = $1 LIMIT 1',
      [contentHash]
    );
    return (rows[0] as KnowledgeNode) || null;
  }

  async findNodesByType(type: KnowledgeNodeType): Promise<KnowledgeNode[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_nodes WHERE type = $1 ORDER BY created_at',
      [type]
    );
    return rows as KnowledgeNode[];
  }

  async findNodeById(id: string): Promise<KnowledgeNode | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_nodes WHERE id = $1',
      [id]
    );
    return (rows[0] as KnowledgeNode) || null;
  }

  async findEdgesFrom(nodeId: string, type?: KnowledgeEdgeType): Promise<KnowledgeEdge[]> {
    if (type) {
      const { rows } = await this.pool.query(
        'SELECT * FROM knowledge_edges WHERE source_id = $1 AND type = $2',
        [nodeId, type]
      );
      return rows as KnowledgeEdge[];
    }
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_edges WHERE source_id = $1',
      [nodeId]
    );
    return rows as KnowledgeEdge[];
  }

  async findEdgesTo(nodeId: string, type?: KnowledgeEdgeType): Promise<KnowledgeEdge[]> {
    if (type) {
      const { rows } = await this.pool.query(
        'SELECT * FROM knowledge_edges WHERE target_id = $1 AND type = $2',
        [nodeId, type]
      );
      return rows as KnowledgeEdge[];
    }
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_edges WHERE target_id = $1',
      [nodeId]
    );
    return rows as KnowledgeEdge[];
  }

  async getVideoGraph(videoNodeId: string): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
    const { rows: nodes } = await this.pool.query(
      `WITH RECURSIVE reachable AS (
        SELECT id FROM knowledge_nodes WHERE id = $1
        UNION
        SELECT e.target_id FROM knowledge_edges e
        JOIN reachable r ON e.source_id = r.id
        WHERE e.type = 'CONTAINS'
      )
      SELECT n.* FROM knowledge_nodes n JOIN reachable r ON n.id = r.id`,
      [videoNodeId]
    );

    if (nodes.length === 0) return { nodes: [], edges: [] };

    const nodeIds = (nodes as KnowledgeNode[]).map((n) => n.id);
    const { rows: edges } = await this.pool.query(
      `SELECT * FROM knowledge_edges WHERE source_id = ANY($1) OR target_id = ANY($1)`,
      [nodeIds]
    );

    return { nodes: nodes as KnowledgeNode[], edges: edges as KnowledgeEdge[] };
  }

  async getAllSegments(): Promise<KnowledgeNode[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM knowledge_nodes WHERE type = 'Segment' ORDER BY (properties->>'sequence_index')::int`
    );
    return rows as KnowledgeNode[];
  }

  async updateNodeProperties(id: string, properties: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE knowledge_nodes SET properties = properties || $1 WHERE id = $2`,
      [JSON.stringify(properties), id]
    );
  }

  async setNodeEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.pool.query(
      `UPDATE knowledge_nodes SET embedding = $1 WHERE id = $2`,
      [`[${embedding.join(',')}]`, id]
    );
  }

  async deleteVideoGraph(videoNodeId: string): Promise<void> {
    await this.pool.query(
      `WITH RECURSIVE reachable AS (
        SELECT id FROM knowledge_nodes WHERE id = $1
        UNION
        SELECT e.target_id FROM knowledge_edges e
        JOIN reachable r ON e.source_id = r.id
        WHERE e.type = 'CONTAINS'
      )
      DELETE FROM knowledge_nodes WHERE id IN (SELECT id FROM reachable)`,
      [videoNodeId]
    );
  }

  async fullTextSearch(query: string, limit: number = 20): Promise<Array<KnowledgeNode & { rank: number }>> {
    const { rows } = await this.pool.query(
      `SELECT *, ts_rank(
        to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, '')),
        plainto_tsquery('simple', $1)
      ) AS rank
      FROM knowledge_nodes
      WHERE to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, ''))
        @@ plainto_tsquery('simple', $1)
      ORDER BY rank DESC
      LIMIT $2`,
      [query, limit]
    );
    return rows as Array<KnowledgeNode & { rank: number }>;
  }

  async semanticSearch(embedding: number[], limit: number = 20): Promise<Array<KnowledgeNode & { distance: number }>> {
    const { rows } = await this.pool.query(
      `SELECT *, embedding <=> $1 AS distance
       FROM knowledge_nodes
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [`[${embedding.join(',')}]`, limit]
    );
    return rows as Array<KnowledgeNode & { distance: number }>;
  }

  async rawTsSearch(tsquery: string, limit: number = 20): Promise<Array<KnowledgeNode & { rank: number }>> {
    const { rows } = await this.pool.query(
      `SELECT *, ts_rank(
        to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, '')),
        to_tsquery('simple', $1)
      ) AS rank
      FROM knowledge_nodes
      WHERE to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, ''))
        @@ to_tsquery('simple', $1)
      ORDER BY rank DESC
      LIMIT $2`,
      [tsquery, limit]
    );
    return rows as Array<KnowledgeNode & { rank: number }>;
  }

  async findEdgesBidirectional(nodeId: string, types?: KnowledgeEdgeType[]): Promise<KnowledgeEdge[]> {
    if (types && types.length > 0) {
      const { rows } = await this.pool.query(
        `SELECT * FROM knowledge_edges
         WHERE (source_id = $1 OR target_id = $1)
           AND type = ANY($2)`,
        [nodeId, types]
      );
      return rows as KnowledgeEdge[];
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM knowledge_edges
       WHERE source_id = $1 OR target_id = $1`,
      [nodeId]
    );
    return rows as KnowledgeEdge[];
  }

  async findNodesByIds(ids: string[]): Promise<KnowledgeNode[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query(
      'SELECT * FROM knowledge_nodes WHERE id = ANY($1)',
      [ids]
    );
    return rows as KnowledgeNode[];
  }

  async findEdgesBidirectionalBatch(nodeIds: string[]): Promise<KnowledgeEdge[]> {
    if (nodeIds.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM knowledge_edges
       WHERE source_id = ANY($1) OR target_id = ANY($1)`,
      [nodeIds]
    );
    return rows as KnowledgeEdge[];
  }

  async getRecentSegments(limit: number = 20): Promise<KnowledgeNode[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM knowledge_nodes
       WHERE type = 'Segment'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows as KnowledgeNode[];
  }

  getPool(): Pool {
    return this.pool;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
