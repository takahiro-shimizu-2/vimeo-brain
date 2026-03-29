import express from 'express';
import cors from 'cors';
import type { Pool } from 'pg';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './controllers/health.controller.js';
import { createSourceRouter } from './controllers/source.controller.js';
import { createWebhookRouter } from './controllers/webhook.controller.js';
import { createChatRouter } from './controllers/chat.controller.js';

export function createApp(pool: Pool): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  // Routes
  app.use(createHealthRouter(pool));
  app.use(createSourceRouter(pool));
  app.use(createWebhookRouter(pool));
  app.use(createChatRouter(pool));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
