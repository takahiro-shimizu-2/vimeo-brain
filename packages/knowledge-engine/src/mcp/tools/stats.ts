import type { GraphStore } from '../../db/connection.js';
import type { KnowledgeNodeType } from '../../schema/nodes.js';

const NODE_TYPES: KnowledgeNodeType[] = [
  'Video',
  'Transcript',
  'Segment',
  'Topic',
  'Concept',
  'NarrativeFlow',
];

export async function handleStats(store: GraphStore): Promise<string> {
  const counts: Record<string, number> = {};
  for (const type of NODE_TYPES) {
    const nodes = await store.findNodesByType(type);
    counts[type] = nodes.length;
  }

  const totalNodes = Object.values(counts).reduce((sum, c) => sum + c, 0);

  const lines: string[] = [
    '## Knowledge Graph Statistics\n',
    `Total Nodes: ${totalNodes}\n`,
    '### By Type',
  ];

  for (const [type, count] of Object.entries(counts)) {
    lines.push(`- ${type}: ${count}`);
  }

  return lines.join('\n');
}
