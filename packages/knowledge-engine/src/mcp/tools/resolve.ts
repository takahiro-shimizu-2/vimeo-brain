import type { GraphStore } from '../../db/connection.js';
import { resolveContext, type QueryIntent } from '../../search/context-resolver.js';
import type { EmbedFn } from '../../pipeline/embedding-generator.js';

export async function handleResolve(
  store: GraphStore,
  params: Record<string, unknown>,
  embedFn: EmbedFn | null,
): Promise<string> {
  const query = typeof params.query === 'string' ? params.query : '';
  if (!query) return 'Error: query parameter is required (must be a non-empty string)';

  const rawTokens = Number(params.max_tokens);
  const maxTokens = rawTokens > 0 ? rawTokens : 4000;

  const validIntents: QueryIntent[] = ['factual', 'overview', 'who_what'];
  const rawIntent = params.intent as string | undefined;
  const intent = rawIntent && validIntents.includes(rawIntent as QueryIntent)
    ? (rawIntent as QueryIntent)
    : undefined;

  const resolved = await resolveContext(store, query, embedFn, {
    maxTokens,
    intent,
  });

  const lines: string[] = [
    `## Resolve: "${query}" (intent: ${resolved.intent})\n`,
    `### Results (${resolved.nodes.length} nodes, ${resolved.totalTokens} tokens, ${resolved.prunedCount} pruned)`,
    `Fallback level: ${resolved.fallbackLevel} (${fallbackLabel(resolved.fallbackLevel)})\n`,
  ];

  for (const sn of resolved.nodes) {
    const props = sn.node.properties as Record<string, unknown>;
    const videoTitle = (props.video_title as string) || '';
    const startMs = (props.start_ms as number) || 0;
    const timestamp = formatMs(startMs);

    lines.push(`#### [${sn.node.type}] ${sn.node.name} (score: ${sn.score.toFixed(3)})`);
    if (videoTitle) lines.push(`- Video: ${videoTitle} @ ${timestamp}`);
    if (sn.node.text_content) lines.push(`- Text: ${sn.node.text_content.slice(0, 300)}`);

    const keywords = (props.keywords as string[]);
    if (keywords && keywords.length > 0) lines.push(`- Keywords: ${keywords.join(', ')}`);

    lines.push(`- Source: ${sn.source}, depth: ${sn.depth}`);
    lines.push('');
  }

  return lines.join('\n');
}

function fallbackLabel(level: number): string {
  switch (level) {
    case 0: return 'direct match';
    case 1: return 'bigram AND';
    case 2: return 'token OR';
    case 3: return 'recent segments';
    default: return 'unknown';
  }
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
