import type { GraphStore } from '../../db/connection.js';

export async function handleQuery(
  store: GraphStore,
  params: Record<string, unknown>
): Promise<string> {
  const query = params.query as string;
  const limit = (params.limit as number) || 10;

  const results = await store.fullTextSearch(query, limit);

  if (results.length === 0) return 'No results found.';

  const lines: string[] = [
    `## Search: "${query}" (${results.length} results)\n`,
  ];

  for (const node of results) {
    const props = node.properties as Record<string, unknown>;
    const videoTitle = (props.video_title as string) || '';
    const startMs = (props.start_ms as number) || 0;
    const timestamp = formatMs(startMs);

    lines.push(`### [${node.type}] ${node.name}`);
    if (videoTitle) lines.push(`- Video: ${videoTitle} @ ${timestamp}`);
    if (node.text_content) lines.push(`- Text: ${node.text_content.slice(0, 300)}`);
    lines.push(`- Score: ${node.rank.toFixed(4)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
