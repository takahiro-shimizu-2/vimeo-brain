import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://vimeo:vimeo@localhost:5432/vimeo_brain'),
  VIMEO_ACCESS_TOKEN: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['openai', 'gemini', 'vertex', 'ollama']).default('ollama'),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'gemini', 'vertex', 'ollama']).default('ollama'),
  OLLAMA_BASE_URL: z.string().default('http://host.docker.internal:11434'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VERTEX_PROJECT_ID: z.string().optional(),
  VERTEX_LOCATION: z.string().default('us-central1'),
  VIMEO_WEBHOOK_SECRET: z.string().optional(),
  CHATWORK_API_TOKEN: z.string().optional(),
  KNOWLEDGE_DATA_DIR: z.string().default('.vimeo-brain'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
