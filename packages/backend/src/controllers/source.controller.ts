import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SourceType } from '@vimeo-brain/shared';
import { SOURCE_CONTENT_TYPE_MAP } from '@vimeo-brain/shared';
import { ContentSourceRepository } from '../repositories/content-source.repository.js';
import { IngestService } from '../services/ingest.service.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../utils/logger.js';

const createSourceSchema = z.object({
  source_type: z.enum(['vimeo', 'youtube', 'chatwork', 'text']),
  source_id: z.string().min(1),
  title: z.string().optional().default(''),
  source_name: z.string().optional(),
});

export function createSourceRouter(pool: Pool): Router {
  const router = Router();
  const sourceRepo = new ContentSourceRepository(pool);
  const ingestService = new IngestService(pool);

  // GET /api/sources
  router.get('/api/sources', async (_req, res, next) => {
    try {
      const sources = await sourceRepo.findAll();
      res.json({ success: true, data: sources });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/sources/:id
  router.get('/api/sources/:id', async (req, res, next) => {
    try {
      const source = await sourceRepo.findById(req.params.id);
      if (!source) throw AppError.notFound('Source not found');
      res.json({ success: true, data: source });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/sources
  router.post('/api/sources', validate(createSourceSchema), async (req, res, next) => {
    try {
      const { source_type, source_id, title, source_name } = req.body as {
        source_type: SourceType;
        source_id: string;
        title: string;
        source_name?: string;
      };
      const existing = await sourceRepo.findBySourceId(source_type, source_id);
      if (existing) throw AppError.badRequest('Source already registered');

      const contentType = SOURCE_CONTENT_TYPE_MAP[source_type];
      const source = await sourceRepo.create(source_type, source_id, contentType, title, source_name);
      res.status(201).json({ success: true, data: source });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/sources/:id
  router.delete('/api/sources/:id', async (req, res, next) => {
    try {
      const deleted = await sourceRepo.delete(req.params.id);
      if (!deleted) throw AppError.notFound('Source not found');
      res.json({ success: true, message: 'Source deleted' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/sources/:id/ingest
  router.post('/api/sources/:id/ingest', async (req, res, next) => {
    try {
      const source = await sourceRepo.findById(req.params.id);
      if (!source) throw AppError.notFound('Source not found');

      ingestService.ingest(req.params.id).catch((err) => {
        logger.error({ err, sourceId: req.params.id }, 'Background ingestion error');
      });

      res.json({ success: true, message: 'Ingestion started' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/sources/:id/ingest/status
  router.get('/api/sources/:id/ingest/status', async (req, res, next) => {
    try {
      const status = await ingestService.getStatus(req.params.id);
      if (!status) throw AppError.notFound('No ingestion record found');
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  });

  // --- Backward compatibility: /api/videos -> /api/sources redirects ---

  router.get('/api/videos', (_req, res) => {
    res.redirect(301, '/api/sources');
  });

  router.get('/api/videos/:id', (req, res) => {
    res.redirect(301, `/api/sources/${req.params.id}`);
  });

  router.post('/api/videos', validate(createSourceSchema), async (req, res, next) => {
    // Duplicate handler for backward compatibility (POST redirect loses body)
    try {
      const { source_type, source_id, title, source_name } = req.body as {
        source_type: SourceType;
        source_id: string;
        title: string;
        source_name?: string;
      };
      const existing = await sourceRepo.findBySourceId(source_type, source_id);
      if (existing) throw AppError.badRequest('Source already registered');

      const contentType = SOURCE_CONTENT_TYPE_MAP[source_type];
      const source = await sourceRepo.create(source_type, source_id, contentType, title, source_name);
      res.status(201).json({ success: true, data: source });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/api/videos/:id', (req, res) => {
    res.redirect(307, `/api/sources/${req.params.id}`);
  });

  router.post('/api/videos/:id/ingest', (req, res) => {
    res.redirect(307, `/api/sources/${req.params.id}/ingest`);
  });

  router.get('/api/videos/:id/ingest/status', (req, res) => {
    res.redirect(301, `/api/sources/${req.params.id}/ingest/status`);
  });

  return router;
}
