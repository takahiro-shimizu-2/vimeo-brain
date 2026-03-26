import type { Pool } from 'pg';
import type { Video, IngestStatus } from '@vimeo-brain/shared';

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

  async findByVimeoId(vimeoId: string): Promise<Video | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM videos WHERE vimeo_id = $1',
      [vimeoId]
    );
    return rows[0] || null;
  }

  async create(vimeoId: string, title: string = ''): Promise<Video> {
    const { rows } = await this.pool.query(
      'INSERT INTO videos (vimeo_id, title) VALUES ($1, $2) RETURNING *',
      [vimeoId, title]
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
