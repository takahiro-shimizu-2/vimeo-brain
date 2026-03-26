import type { GraphStore } from '../../db/connection.js';

export async function handleFlows(store: GraphStore): Promise<string> {
  const flows = await store.findNodesByType('NarrativeFlow');

  if (flows.length === 0) return 'No narrative flows detected yet.';

  const lines: string[] = [`## Narrative Flows (${flows.length})\n`];

  for (const flow of flows) {
    const props = flow.properties as Record<string, unknown>;
    const stepCount = (props.step_count as number) || 0;
    const topics = (props.topics as string[]) || [];

    lines.push(`### ${flow.name}`);
    lines.push(`- Steps: ${stepCount}`);
    lines.push(`- Type: ${(props.flow_type as string) || 'narrative'}`);
    if (topics.length > 0) lines.push(`- Related Topics: ${topics.length}`);
    lines.push('');
  }

  return lines.join('\n');
}
