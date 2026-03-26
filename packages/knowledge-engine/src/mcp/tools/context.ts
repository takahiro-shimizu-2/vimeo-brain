import type { GraphStore } from '../../db/connection.js';

export async function handleContext(
  store: GraphStore,
  params: Record<string, unknown>
): Promise<string> {
  const id = params.id as string | undefined;
  const name = params.name as string | undefined;

  let node;
  if (id) {
    node = await store.findNodeById(id);
  } else if (name) {
    const results = await store.fullTextSearch(name, 1);
    node = results[0] || null;
  }

  if (!node) return 'Node not found.';

  const outgoing = await store.findEdgesFrom(node.id);
  const incoming = await store.findEdgesTo(node.id);

  const lines: string[] = [
    `## ${node.type}: ${node.name}`,
    `- ID: ${node.id}`,
    `- Hash: ${node.content_hash || 'none'}`,
  ];

  if (node.text_content) {
    lines.push(`- Content: ${node.text_content.slice(0, 500)}`);
  }

  const props = node.properties as Record<string, unknown>;
  if (Object.keys(props).length > 0) {
    lines.push(`- Properties: ${JSON.stringify(props, null, 2)}`);
  }

  if (outgoing.length > 0) {
    lines.push(`\n### Outgoing Edges (${outgoing.length})`);
    for (const edge of outgoing.slice(0, 20)) {
      const target = await store.findNodeById(edge.target_id);
      lines.push(
        `- [${edge.type}] -> ${target?.type || '?'}: ${target?.name || edge.target_id}`
      );
    }
  }

  if (incoming.length > 0) {
    lines.push(`\n### Incoming Edges (${incoming.length})`);
    for (const edge of incoming.slice(0, 20)) {
      const source = await store.findNodeById(edge.source_id);
      lines.push(
        `- [${edge.type}] <- ${source?.type || '?'}: ${source?.name || edge.source_id}`
      );
    }
  }

  return lines.join('\n');
}
