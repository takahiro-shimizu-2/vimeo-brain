import { Pool } from 'pg';
import { config } from './config.js';
import { createApp } from './app.js';
import { PollingService } from './services/polling.service.js';
import { logger } from './utils/logger.js';

const pool = new Pool({
  connectionString: config.DATABASE_URL,
});

const app = createApp(pool);

const pollingService = new PollingService(pool);

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Server started');
  pollingService.start();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  pollingService.stop();
  await pool.end();
  process.exit(0);
});
