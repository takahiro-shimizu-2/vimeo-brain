import { Router } from 'express';
import type { Pool } from 'pg';
import crypto from 'crypto';
import { config } from '../config.js';
import { IngestService } from '../services/ingest.service.js';
import { VideoRepository } from '../repositories/video.repository.js';
import { logger } from '../utils/logger.js';

function extractVimeoId(uri: string): string | null {
  if (!uri) return null;
  const match = uri.match(/(?:\/videos\/)?(\d+)/);
  return match ? match[1] : null;
}

export function createWebhookRouter(pool: Pool): Router {
  const router = Router();
  const videoRepo = new VideoRepository(pool);
  const ingestService = new IngestService(pool);

  // POST /api/webhooks/vimeo
  router.post('/api/webhooks/vimeo', async (req, res, next) => {
    try {
      if (config.VIMEO_WEBHOOK_SECRET) {
        const signature = req.headers['x-vimeo-signature'] as string | undefined;
        if (!signature) {
          res.status(401).json({ error: 'Missing signature' });
          return;
        }
        const body = JSON.stringify(req.body);
        const expected = crypto
          .createHmac('sha256', config.VIMEO_WEBHOOK_SECRET)
          .update(body)
          .digest('hex');
        if (signature !== expected) {
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
      }

      const { topic, video_id } = req.body as {
        topic: string;
        video_id: string;
      };
      logger.info({ topic, video_id }, 'Vimeo webhook received');

      if (topic === 'video.text_track.complete') {
        const vimeoId = extractVimeoId(video_id);
        if (vimeoId) {
          const video = await videoRepo.findByVimeoId(vimeoId);
          if (video) {
            ingestService.ingest(video.id).catch((err) => {
              logger.error({ err, videoId: video.id }, 'Webhook-triggered ingestion error');
            });
          }
        }
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
