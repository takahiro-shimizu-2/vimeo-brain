import { Router } from 'express';
import type { Pool } from 'pg';

export function createHealthRouter(pool: Pool): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  router.get('/readiness', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'not ready', database: 'disconnected' });
    }
  });

  return router;
}
