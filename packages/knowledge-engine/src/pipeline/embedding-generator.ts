import type { GraphStore } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const EMBED_BATCH_SIZE = 50;

export async function generateEmbeddings(
  store: GraphStore,
  embedFn: EmbedFn
): Promise<number> {
  const segments = await store.findNodesByType('Segment');
  let count = 0;

  for (let i = 0; i < segments.length; i += EMBED_BATCH_SIZE) {
    const batch = segments.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(s => s.text_content || s.name);

    try {
      const embeddings = await embedFn(texts);
      for (let j = 0; j < batch.length; j++) {
        if (embeddings[j]) {
          await store.setNodeEmbedding(batch[j].id, embeddings[j]);
          count++;
        }
      }
    } catch (err) {
      logger.warn({ err, batchStart: i }, 'Embedding generation failed for batch');
    }
  }

  const concepts = await store.findNodesByType('Concept');
  for (let i = 0; i < concepts.length; i += EMBED_BATCH_SIZE) {
    const batch = concepts.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(c => `${c.name}: ${c.text_content || ''}`);

    try {
      const embeddings = await embedFn(texts);
      for (let j = 0; j < batch.length; j++) {
        if (embeddings[j]) {
          await store.setNodeEmbedding(batch[j].id, embeddings[j]);
          count++;
        }
      }
    } catch (err) {
      logger.warn({ err, batchStart: i }, 'Concept embedding failed for batch');
    }
  }

  logger.info({ embeddedCount: count }, 'Embeddings generated');
  return count;
}
