import type { GraphStore } from '../../db/connection.js';

export async function handleTopics(store: GraphStore): Promise<string> {
  const topics = await store.findNodesByType('Topic');

  if (topics.length === 0) return 'No topics detected yet.';

  const lines: string[] = [`## Topics (${topics.length})\n`];

  for (const topic of topics) {
    const props = topic.properties as Record<string, unknown>;
    const keywords = (props.keywords as string[]) || [];
    const segCount = (props.segment_count as number) || 0;

    lines.push(`### ${topic.name}`);
    lines.push(`- Segments: ${segCount}`);
    if (keywords.length > 0) lines.push(`- Keywords: ${keywords.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}
