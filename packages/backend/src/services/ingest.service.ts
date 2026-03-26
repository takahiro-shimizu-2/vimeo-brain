import type { Pool } from 'pg';
import type { IngestResult, IngestStatus, VideoSourceType } from '@vimeo-brain/shared';
import { runPipeline, type PipelineResult } from '@vimeo-brain/knowledge-engine';
import type { VideoSourceService } from './video-source.js';
import { VimeoService } from './vimeo.service.js';
import { YouTubeService } from './youtube.service.js';
import { EmbeddingService } from './embedding.service.js';
import { LlmService } from './llm.service.js';
import { VideoRepository } from '../repositories/video.repository.js';
import { logger } from '../utils/logger.js';

export class IngestService {
  private sources: Map<VideoSourceType, VideoSourceService>;
  private embeddingService: EmbeddingService;
  private llmService: LlmService;
  private videoRepo: VideoRepository;

  constructor(private pool: Pool) {
    this.sources = new Map<VideoSourceType, VideoSourceService>([
      ['vimeo', new VimeoService()],
      ['youtube', new YouTubeService()],
    ]);
    this.embeddingService = new EmbeddingService();
    this.llmService = new LlmService();
    this.videoRepo = new VideoRepository(pool);
  }

  async ingest(videoId: string): Promise<IngestResult> {
    const video = await this.videoRepo.findById(videoId);
    if (!video) {
      return {
        video_id: videoId,
        status: 'failed',
        segment_count: 0,
        content_hash: '',
        error_message: 'Video not found',
      };
    }

    await this.videoRepo.updateStatus(videoId, 'processing');
    await this.updateIngestLog(videoId, 'processing', 0, null, null);

    try {
      const source = this.sources.get(video.source_type);
      if (!source) {
        throw new Error(`Unsupported video source type: ${video.source_type}`);
      }

      const vttContent = await source.getTranscriptVtt(video.source_id);

      let title = video.title;
      let description = video.description;
      if (!title) {
        const metadata = await source.getMetadata(video.source_id);
        title = metadata.title;
        description = metadata.description;
        await this.pool.query(
          'UPDATE videos SET title = $1, description = $2, duration_seconds = $3, thumbnail_url = $4 WHERE id = $5',
          [title, description, metadata.duration_seconds, metadata.thumbnail_url, videoId]
        );
      }

      const result: PipelineResult = await runPipeline(
        video.source_id,
        title,
        description,
        vttContent,
        {
          pool: this.pool,
          llmFn: (prompt: string) => this.llmService.complete(prompt),
          embedFn: (texts: string[]) => this.embeddingService.embed(texts),
        }
      );

      await this.videoRepo.updateStatus(videoId, 'completed');
      await this.videoRepo.updateContentHash(videoId, result.contentHash);
      await this.updateIngestLog(
        videoId,
        'completed',
        7,
        null,
        null,
        result.segmentCount
      );

      logger.info(
        { videoId, segmentCount: result.segmentCount },
        'Ingestion completed'
      );

      return {
        video_id: videoId,
        status: 'completed',
        segment_count: result.segmentCount,
        content_hash: result.contentHash,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.videoRepo.updateStatus(videoId, 'failed');
      await this.updateIngestLog(videoId, 'failed', 0, null, errorMessage);
      logger.error({ err, videoId }, 'Ingestion failed');

      return {
        video_id: videoId,
        status: 'failed',
        segment_count: 0,
        content_hash: '',
        error_message: errorMessage,
      };
    }
  }

  async getStatus(
    videoId: string
  ): Promise<{
    status: IngestStatus;
    last_completed_stage: number | null;
    error_message: string | null;
  } | null> {
    const { rows } = await this.pool.query(
      'SELECT status, last_completed_stage, error_message FROM ingest_log WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1',
      [videoId]
    );
    return (rows[0] as {
      status: IngestStatus;
      last_completed_stage: number | null;
      error_message: string | null;
    }) || null;
  }

  private async updateIngestLog(
    videoId: string,
    status: IngestStatus,
    stage: number,
    stageName: string | null,
    errorMessage: string | null,
    segmentCount: number = 0
  ): Promise<void> {
    const { rows } = await this.pool.query(
      'SELECT id FROM ingest_log WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1',
      [videoId]
    );

    const stageDetails = stageName
      ? JSON.stringify({ current: stageName })
      : null;

    if (rows[0]) {
      await this.pool.query(
        `UPDATE ingest_log
         SET status = $1, last_completed_stage = $2, stage_details = $3,
             error_message = $4, segment_count = $5, updated_at = NOW()
         WHERE id = $6`,
        [status, stage, stageDetails, errorMessage, segmentCount, rows[0].id]
      );
    } else {
      await this.pool.query(
        `INSERT INTO ingest_log
           (video_id, content_hash, segment_count, status, last_completed_stage, stage_details, error_message)
         VALUES ($1, '', $2, $3, $4, $5, $6)`,
        [videoId, segmentCount, status, stage, stageDetails, errorMessage]
      );
    }
  }
}
