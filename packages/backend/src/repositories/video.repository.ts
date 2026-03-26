import type { Pool } from 'pg';
import type { Video, IngestStatus, VideoSourceType } from '@vimeo-brain/shared';

export class VideoRepository {
  constructor(private readonly pool: Pool) {}

  async findAll(): Promise<Video[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM videos ORDER BY created_at DESC'
    );
    return rows;
  }

  async findById(id: string): Promise<Video | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM videos WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  async findBySourceId(sourceType: VideoSourceType, sourceId: string): Promise<Video | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM videos WHERE source_type = $1 AND source_id = $2',
      [sourceType, sourceId]
    );
    return rows[0] || null;
  }

  async create(sourceType: VideoSourceType, sourceId: string, title: string = ''): Promise<Video> {
    const { rows } = await this.pool.query(
      'INSERT INTO videos (source_type, source_id, title) VALUES ($1, $2, $3) RETURNING *',
      [sourceType, sourceId, title]
    );
    return rows[0];
  }

  async updateStatus(id: string, status: IngestStatus): Promise<Video | null> {
    const { rows } = await this.pool.query(
      'UPDATE videos SET ingest_status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    return rows[0] || null;
  }

  async updateContentHash(id: string, contentHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE videos SET content_hash = $1 WHERE id = $2',
      [contentHash, id]
    );
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM videos WHERE id = $1',
      [id]
    );
    return (rowCount ?? 0) > 0;
  }
}
