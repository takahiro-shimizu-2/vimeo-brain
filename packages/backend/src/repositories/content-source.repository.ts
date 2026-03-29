import type { Pool } from 'pg';
import type { ContentSource, ContentType, IngestStatus, SourceType } from '@vimeo-brain/shared';

export class ContentSourceRepository {
  constructor(private readonly pool: Pool) {}

  async findAll(): Promise<ContentSource[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM content_sources ORDER BY created_at DESC'
    );
    return rows;
  }

  async findById(id: string): Promise<ContentSource | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM content_sources WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  async findBySourceId(sourceType: SourceType, sourceId: string): Promise<ContentSource | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM content_sources WHERE source_type = $1 AND source_id = $2',
      [sourceType, sourceId]
    );
    return rows[0] || null;
  }

  async create(
    sourceType: SourceType,
    sourceId: string,
    contentType: ContentType,
    title: string = '',
    sourceName?: string,
  ): Promise<ContentSource> {
    const { rows } = await this.pool.query(
      `INSERT INTO content_sources
         (source_type, source_id, content_type, title, source_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sourceType, sourceId, contentType, title, sourceName || null]
    );
    return rows[0];
  }

  async updateStatus(id: string, status: IngestStatus): Promise<ContentSource | null> {
    const { rows } = await this.pool.query(
      'UPDATE content_sources SET ingest_status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    return rows[0] || null;
  }

  async updateContentHash(id: string, contentHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE content_sources SET content_hash = $1 WHERE id = $2',
      [contentHash, id]
    );
  }

  async updateMetadata(
    id: string,
    metadata: {
      title?: string;
      description?: string | null;
      duration_seconds?: number | null;
      thumbnail_url?: string | null;
      source_name?: string | null;
    },
  ): Promise<ContentSource | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (metadata.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(metadata.title);
    }
    if (metadata.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(metadata.description);
    }
    if (metadata.duration_seconds !== undefined) {
      setClauses.push(`duration_seconds = $${paramIndex++}`);
      values.push(metadata.duration_seconds);
    }
    if (metadata.thumbnail_url !== undefined) {
      setClauses.push(`thumbnail_url = $${paramIndex++}`);
      values.push(metadata.thumbnail_url);
    }
    if (metadata.source_name !== undefined) {
      setClauses.push(`source_name = $${paramIndex++}`);
      values.push(metadata.source_name);
    }

    if (setClauses.length === 0) return this.findById(id);

    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE content_sources SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM content_sources WHERE id = $1',
      [id]
    );
    return (rowCount ?? 0) > 0;
  }
}
