import type { Pool } from 'pg';
import type { ChatSource, ChatMessage } from '@vimeo-brain/shared';
import { GraphStore, hybridSearch, type SearchResult } from '@vimeo-brain/knowledge-engine';
import { ChatRepository } from '../repositories/chat.repository.js';
import { LlmService } from './llm.service.js';
import { EmbeddingService } from './embedding.service.js';
import { logger } from '../utils/logger.js';

export class ChatService {
  private chatRepo: ChatRepository;
  private llmService: LlmService;
  private embeddingService: EmbeddingService;
  private graphStore: GraphStore;

  constructor(pool: Pool) {
    this.chatRepo = new ChatRepository(pool);
    this.llmService = new LlmService();
    this.embeddingService = new EmbeddingService();
    this.graphStore = new GraphStore(pool);
  }

  async chat(
    sessionId: string | undefined,
    message: string,
  ): Promise<{
    session_id: string;
    message: ChatMessage;
  }> {
    let sid = sessionId;
    if (!sid) {
      const session = await this.chatRepo.createSession(message.slice(0, 50));
      sid = session.id;
    }

    await this.chatRepo.addMessage(sid, 'user', message);

    const results = await hybridSearch(
      this.graphStore,
      message,
      (texts) => this.embeddingService.embed(texts),
      { limit: 5 },
    );

    const { contextText, sources } = this.buildContext(results);
    const prompt = this.buildPrompt(message, contextText);

    logger.debug({ sessionId: sid, resultCount: results.length }, 'RAG search completed');

    const response = await this.llmService.complete(prompt);

    const assistantMsg = await this.chatRepo.addMessage(
      sid,
      'assistant',
      response,
      sources.length > 0 ? sources : undefined,
    );

    return { session_id: sid, message: assistantMsg };
  }

  private buildContext(results: SearchResult[]): {
    contextText: string;
    sources: ChatSource[];
  } {
    const sources: ChatSource[] = [];
    const parts: string[] = [];

    for (const result of results) {
      const props = result.node.properties as Record<string, unknown>;
      const videoTitle = (props.video_title as string) || 'Unknown';
      const videoId = (props.video_id as string) || '';
      const startMs = (props.start_ms as number) || 0;
      const text = result.node.text_content || result.node.name || '';

      if (text) {
        const timestamp = formatTimestamp(startMs);
        parts.push(`[${videoTitle} @ ${timestamp}]: ${text}`);
        sources.push({
          video_id: videoId,
          video_title: videoTitle,
          timestamp_ms: startMs,
          segment_text: text.slice(0, 200),
        });
      }
    }

    return { contextText: parts.join('\n\n'), sources };
  }

  private buildPrompt(question: string, context: string): string {
    if (!context) {
      return `ユーザーの質問に答えてください。関連する動画情報がない場合はその旨を伝えてください。\n\n質問: ${question}`;
    }

    return `以下の動画の文字起こしに基づいて、ユーザーの質問に答えてください。回答は日本語で、具体的に。情報源の動画タイトルとタイムスタンプを参照してください。

--- 関連する動画の文字起こし ---
${context}
--- ここまで ---

質問: ${question}`;
  }

  async getSessions() {
    return this.chatRepo.findAllSessions();
  }

  async getSession(id: string) {
    const session = await this.chatRepo.findSessionById(id);
    if (!session) return null;
    const messages = await this.chatRepo.findMessagesBySessionId(id);
    return { ...session, messages };
  }

  async deleteSession(id: string) {
    return this.chatRepo.deleteSession(id);
  }
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
