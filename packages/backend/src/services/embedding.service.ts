import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class EmbeddingService {
  async embed(texts: string[]): Promise<number[][]> {
    if (config.EMBEDDING_PROVIDER === 'openai') {
      return this.embedOpenAI(texts);
    }
    // Anthropic does not have a standalone embeddings API; fall back to OpenAI
    return this.embedOpenAI(texts);
  }

  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    if (!config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY required for embeddings');
    }

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, 'OpenAI embeddings error');
      throw new Error(`OpenAI embeddings error: ${res.status}`);
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }
}
