import type { Pool } from 'pg';
import { VideoRepository } from '../repositories/video.repository.js';
import { IngestService } from './ingest.service.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const POLL_INTERVAL_MS = 30 * 60 * 1000;

export class PollingService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private videoRepo: VideoRepository;
  private ingestService: IngestService;

  constructor(private pool: Pool) {
    this.videoRepo = new VideoRepository(pool);
    this.ingestService = new IngestService(pool);
  }

  start(): void {
    if (!config.VIMEO_ACCESS_TOKEN) {
      logger.warn('VIMEO_ACCESS_TOKEN not set, polling disabled');
      return;
    }
    logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Polling service started');
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        logger.error({ err }, 'Polling error');
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Polling service stopped');
    }
  }

  private async poll(): Promise<void> {
    logger.info('Polling for new videos...');
    const videos = await this.videoRepo.findAll();

    for (const video of videos) {
      if (video.ingest_status === 'pending') {
        logger.info(
          { videoId: video.id, vimeoId: video.vimeo_id },
          'Auto-ingesting pending video',
        );
        try {
          await this.ingestService.ingest(video.id);
        } catch (err) {
          logger.error(
            { err, videoId: video.id },
            'Failed to ingest video during polling',
          );
        }
      }
    }
  }
}
