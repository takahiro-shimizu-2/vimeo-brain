import express from 'express';
import cors from 'cors';
import type { Pool } from 'pg';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './controllers/health.controller.js';

export function createApp(pool: Pool): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  // Routes
  app.use(createHealthRouter(pool));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
