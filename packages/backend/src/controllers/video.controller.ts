import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { VideoRepository } from '../repositories/video.repository.js';
import { IngestService } from '../services/ingest.service.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../utils/logger.js';

const createVideoSchema = z.object({
  vimeo_id: z.string().min(1),
  title: z.string().optional().default(''),
});

export function createVideoRouter(pool: Pool): Router {
  const router = Router();
  const videoRepo = new VideoRepository(pool);
  const ingestService = new IngestService(pool);

  // GET /api/videos
  router.get('/api/videos', async (_req, res, next) => {
    try {
      const videos = await videoRepo.findAll();
      res.json({ success: true, data: videos });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/videos/:id
  router.get('/api/videos/:id', async (req, res, next) => {
    try {
      const video = await videoRepo.findById(req.params.id);
      if (!video) throw AppError.notFound('Video not found');
      res.json({ success: true, data: video });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/videos
  router.post('/api/videos', validate(createVideoSchema), async (req, res, next) => {
    try {
      const { vimeo_id, title } = req.body as { vimeo_id: string; title: string };
      const existing = await videoRepo.findByVimeoId(vimeo_id);
      if (existing) throw AppError.badRequest('Video already registered');
      const video = await videoRepo.create(vimeo_id, title);
      res.status(201).json({ success: true, data: video });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/videos/:id
  router.delete('/api/videos/:id', async (req, res, next) => {
    try {
      const deleted = await videoRepo.delete(req.params.id);
      if (!deleted) throw AppError.notFound('Video not found');
      res.json({ success: true, message: 'Video deleted' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/videos/:id/ingest
  router.post('/api/videos/:id/ingest', async (req, res, next) => {
    try {
      const video = await videoRepo.findById(req.params.id);
      if (!video) throw AppError.notFound('Video not found');

      ingestService.ingest(req.params.id).catch((err) => {
        logger.error({ err, videoId: req.params.id }, 'Background ingestion error');
      });

      res.json({ success: true, message: 'Ingestion started' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/videos/:id/ingest/status
  router.get('/api/videos/:id/ingest/status', async (req, res, next) => {
    try {
      const status = await ingestService.getStatus(req.params.id);
      if (!status) throw AppError.notFound('No ingestion record found');
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
