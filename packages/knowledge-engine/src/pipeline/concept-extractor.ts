import { logger } from '../utils/logger.js';

export interface ExtractedConcept {
  name: string;
  type: string;
  description: string;
}

export interface SegmentConcepts {
  segment_index: number;
  concepts: ExtractedConcept[];
}

export type LlmExtractFn = (prompt: string) => Promise<string>;

const BATCH_SIZE = 20;

const SYSTEM_PROMPT = `You are a concept extraction expert. Given text segments from video transcripts, extract key concepts, entities, and topics mentioned.

For each concept, provide:
- name: the concept name (e.g., "React", "dependency injection", "John Smith")
- type: one of: person, technology, methodology, term, organization, product, event, place
- description: a brief description (1 sentence)

Respond ONLY with a valid JSON array. Example:
[{"name": "React", "type": "technology", "description": "A JavaScript library for building user interfaces"}]

If no meaningful concepts are found, return an empty array: []`;

export async function extractConcepts(
  segments: Array<{ index: number; text: string }>,
  llmFn: LlmExtractFn
): Promise<SegmentConcepts[]> {
  const results: SegmentConcepts[] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const batchText = batch
      .map((s) => `[Segment ${s.index}]: ${s.text}`)
      .join('\n\n');

    const prompt = `${SYSTEM_PROMPT}\n\n--- SEGMENTS ---\n${batchText}`;

    try {
      const response = await llmFn(prompt);
      const parsed = parseConceptResponse(response);

      for (const seg of batch) {
        results.push({
          segment_index: seg.index,
          concepts: parsed,
        });
      }
    } catch (err) {
      logger.warn({ err, batchStart: i, batchSize: batch.length }, 'Concept extraction failed for batch');
      for (const seg of batch) {
        results.push({ segment_index: seg.index, concepts: [] });
      }
    }
  }

  return results;
}

function parseConceptResponse(response: string): ExtractedConcept[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: unknown): item is ExtractedConcept =>
        typeof item === 'object' &&
        item !== null &&
        'name' in item &&
        'type' in item &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).type === 'string'
    ).map((item) => ({
      name: item.name,
      type: item.type,
      description: item.description || '',
    }));
  } catch {
    return [];
  }
}
