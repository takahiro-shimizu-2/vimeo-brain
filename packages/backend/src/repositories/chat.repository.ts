import type { Pool } from 'pg';
import type { ChatSession, ChatMessage, MessageRole, ChatSource } from '@vimeo-brain/shared';

export class ChatRepository {
  constructor(private readonly pool: Pool) {}

  async createSession(title?: string): Promise<ChatSession> {
    const { rows } = await this.pool.query(
      'INSERT INTO chat_sessions (title) VALUES ($1) RETURNING *',
      [title || null]
    );
    return rows[0];
  }

  async findAllSessions(): Promise<ChatSession[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM chat_sessions ORDER BY updated_at DESC'
    );
    return rows;
  }

  async findSessionById(id: string): Promise<ChatSession | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM chat_sessions WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  async deleteSession(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM chat_sessions WHERE id = $1',
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async addMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    sources?: ChatSource[],
  ): Promise<ChatMessage> {
    const { rows } = await this.pool.query(
      'INSERT INTO chat_messages (session_id, role, content, sources) VALUES ($1, $2, $3, $4) RETURNING *',
      [sessionId, role, content, sources ? JSON.stringify(sources) : null]
    );
    // Update session updated_at
    await this.pool.query(
      'UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1',
      [sessionId]
    );
    return rows[0];
  }

  async findMessagesBySessionId(sessionId: string): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    );
    return rows;
  }
}
