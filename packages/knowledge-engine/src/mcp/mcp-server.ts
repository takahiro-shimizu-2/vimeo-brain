import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Pool } from 'pg';
import { GraphStore } from '../db/connection.js';
import { handleQuery } from './tools/query.js';
import { handleContext } from './tools/context.js';
import { handleSearch } from './tools/search.js';
import { handleTopics } from './tools/topics.js';
import { handleFlows } from './tools/flows.js';
import { handleStats } from './tools/stats.js';
import { handleResolve } from './tools/resolve.js';
import type { EmbedFn } from '../pipeline/embedding-generator.js';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://vimeo:vimeo@localhost:5434/vimeo_brain';

const pool = new Pool({ connectionString: DATABASE_URL });
const store = new GraphStore(pool);

// Lazy-resolved embedFn — initialised in main()
let resolveEmbedFn: EmbedFn | null = null;

async function initEmbedFn(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    // Dynamic require — openai may not be installed in knowledge-engine
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAI = require('openai').default as new () => {
      embeddings: {
        create(params: { model: string; input: string[] }): Promise<{
          data: Array<{ embedding: number[] }>;
        }>;
      };
    };
    const openai = new OpenAI();
    resolveEmbedFn = async (texts: string[]): Promise<number[][]> => {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
      });
      return response.data.map((d) => d.embedding);
    };
  } catch {
    // openai package not available — FTS + graph only
  }
}

const server = new Server(
  { name: 'vimeo-brain-knowledge', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'knowledge_query',
      description:
        'Search knowledge graph by concept. Returns segments grouped by topic.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: {
            type: 'number',
            description: 'Max results (default: 10)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'knowledge_context',
      description:
        '360-degree view of a knowledge node (segment, concept, topic). Shows related nodes, edges, and metadata.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Node name to look up' },
          id: { type: 'string', description: 'Direct node ID (optional)' },
        },
      },
    },
    {
      name: 'knowledge_search',
      description:
        'Full-text search across all indexed video transcripts.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search text' },
          limit: {
            type: 'number',
            description: 'Max results (default: 20)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'knowledge_topics',
      description: 'List all detected topics in the knowledge graph.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'knowledge_flows',
      description: 'List all detected narrative flows.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'knowledge_stats',
      description:
        'Get knowledge graph statistics (node counts, edge counts, etc).',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'knowledge_resolve',
      description:
        'Advanced context resolution with Japanese preprocessing, graph expansion, and token budget management. Returns the most relevant knowledge nodes for a query.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query (Japanese or English)',
          },
          max_tokens: {
            type: 'number',
            description: 'Token budget for results (default: 4000)',
          },
          intent: {
            type: 'string',
            enum: ['factual', 'overview', 'who_what'],
            description:
              'Query intent override (auto-detected if omitted)',
          },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args || {}) as Record<string, unknown>;

  try {
    let result: string;
    switch (name) {
      case 'knowledge_query':
        result = await handleQuery(store, params);
        break;
      case 'knowledge_context':
        result = await handleContext(store, params);
        break;
      case 'knowledge_search':
        result = await handleSearch(store, params);
        break;
      case 'knowledge_topics':
        result = await handleTopics(store);
        break;
      case 'knowledge_flows':
        result = await handleFlows(store);
        break;
      case 'knowledge_stats':
        result = await handleStats(store);
        break;
      case 'knowledge_resolve':
        result = await handleResolve(store, params, resolveEmbedFn);
        break;
      default:
        result = `Unknown tool: ${name}`;
    }
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
});

async function main(): Promise<void> {
  await initEmbedFn();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
