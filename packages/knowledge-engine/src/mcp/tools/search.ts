import type { GraphStore } from '../../db/connection.js';

export async function handleSearch(
  store: GraphStore,
  params: Record<string, unknown>
): Promise<string> {
  const query = params.query as string;
  const limit = (params.limit as number) || 20;

  const results = await store.fullTextSearch(query, limit);

  if (results.length === 0) return 'No results found.';

  const lines: string[] = [`## Full-Text Search: "${query}"\n`];

  for (const node of results) {
    const props = node.properties as Record<string, unknown>;
    const videoTitle = (props.video_title as string) || '';
    const startMs = (props.start_ms as number) || 0;

    lines.push(
      `- **${node.name}** (${node.type}, score: ${node.rank.toFixed(4)})`
    );
    if (videoTitle) {
      const s = Math.floor(startMs / 1000);
      lines.push(
        `  Video: ${videoTitle} @ ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
      );
    }
    if (node.text_content) {
      lines.push(`  ${node.text_content.slice(0, 200)}`);
    }
  }

  return lines.join('\n');
}
