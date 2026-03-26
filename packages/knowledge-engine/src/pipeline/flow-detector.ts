import type { GraphStore } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export interface DetectedFlow {
  steps: string[];
  topicIds: string[];
}

export async function detectFlows(store: GraphStore): Promise<DetectedFlow[]> {
  const segments = await store.findNodesByType('Segment');
  if (segments.length === 0) return [];

  // Build adjacency from FOLLOWS edges
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const seg of segments) {
    adj.set(seg.id, []);
    inDegree.set(seg.id, 0);
  }

  for (const seg of segments) {
    const follows = await store.findEdgesFrom(seg.id, 'FOLLOWS');
    for (const edge of follows) {
      if (adj.has(edge.target_id)) {
        adj.get(seg.id)!.push(edge.target_id);
        inDegree.set(edge.target_id, (inDegree.get(edge.target_id) || 0) + 1);
      }
    }
  }

  // Find entry points (in-degree 0 in FOLLOWS graph)
  const entryPoints = segments
    .filter(s => (inDegree.get(s.id) || 0) === 0)
    .map(s => s.id);

  // BFS from each entry point to build flows
  const flows: DetectedFlow[] = [];
  const visited = new Set<string>();

  for (const entry of entryPoints) {
    if (visited.has(entry)) continue;

    const steps: string[] = [];
    const queue = [entry];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      steps.push(current);

      const neighbors = adj.get(current) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (steps.length >= 2) {
      const topicIds = new Set<string>();
      for (const stepId of steps) {
        const topicEdges = await store.findEdgesFrom(stepId, 'PART_OF_TOPIC');
        for (const edge of topicEdges) {
          topicIds.add(edge.target_id);
        }
      }

      flows.push({
        steps,
        topicIds: Array.from(topicIds),
      });
    }
  }

  logger.info({ flows: flows.length, totalSteps: flows.reduce((sum, f) => sum + f.steps.length, 0) }, 'Flows detected');
  return flows;
}

export async function storeFlows(store: GraphStore, flows: DetectedFlow[]): Promise<string[]> {
  const flowNodeIds: string[] = [];

  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i];
    const flowNode = await store.addNode(
      'NarrativeFlow',
      `Flow ${i + 1}`,
      null,
      {
        flow_type: 'narrative',
        step_count: flow.steps.length,
        topics: flow.topicIds,
      },
      null
    );
    flowNodeIds.push(flowNode.id);

    for (let step = 0; step < flow.steps.length; step++) {
      await store.addEdge(flow.steps[step], flowNode.id, 'STEP_IN_FLOW', { step });
    }
  }

  return flowNodeIds;
}
