import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://vimeo:vimeo@localhost:5432/vimeo_brain'),
  VIMEO_ACCESS_TOKEN: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VIMEO_WEBHOOK_SECRET: z.string().optional(),
  KNOWLEDGE_DATA_DIR: z.string().default('.vimeo-brain'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
