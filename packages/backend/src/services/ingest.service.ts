import type { Pool } from 'pg';
import type { IngestResult, IngestStatus, SourceType } from '@vimeo-brain/shared';
import { runPipeline, runPipelineFromSegments, sha256, type PipelineResult } from '@vimeo-brain/knowledge-engine';
import type { ContentSourceService } from './content-source.js';
import { VimeoService } from './vimeo.service.js';
import { YouTubeService } from './youtube.service.js';
import { TextSourceService } from './text-source.service.js';
import { ChatworkSourceService } from './chatwork-source.service.js';
import { EmbeddingService } from './embedding.service.js';
import { LlmService } from './llm.service.js';
import { ContentSourceRepository } from '../repositories/content-source.repository.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Map SourceType to knowledge graph node type.
 */
export function sourceTypeToNodeType(sourceType: SourceType): string {
  switch (sourceType) {
    case 'vimeo':
    case 'youtube':
      return 'Video';
    case 'chatwork':
      return 'ChatRoom';
    case 'text':
      return 'Document';
  }
}

export class IngestService {
  private sources: Map<SourceType, ContentSourceService>;
  private embeddingService: EmbeddingService;
  private llmService: LlmService;
  private sourceRepo: ContentSourceRepository;

  constructor(private pool: Pool) {
    this.sources = new Map<SourceType, ContentSourceService>([
      ['vimeo', new VimeoService()],
      ['youtube', new YouTubeService()],
      ['text', new TextSourceService(config.KNOWLEDGE_DATA_DIR)],
      ['chatwork', new ChatworkSourceService(config.CHATWORK_API_TOKEN || '')],
    ]);
    this.embeddingService = new EmbeddingService();
    this.llmService = new LlmService();
    this.sourceRepo = new ContentSourceRepository(pool);
  }

  async ingest(sourceId: string): Promise<IngestResult> {
    const source = await this.sourceRepo.findById(sourceId);
    if (!source) {
      return {
        source_id: sourceId,
        status: 'failed',
        segment_count: 0,
        content_hash: '',
        error_message: 'Source not found',
      };
    }

    await this.sourceRepo.updateStatus(sourceId, 'processing');
    await this.updateIngestLog(sourceId, 'processing', 0, null, null);

    try {
      const service = this.sources.get(source.source_type);
      if (!service) {
        throw new Error(`Unsupported source type: ${source.source_type}`);
      }

      const fetchResult = await service.fetchContent(source.source_id);

      // Update metadata if title was empty
      if (!source.title && fetchResult.title) {
        await this.sourceRepo.updateMetadata(sourceId, {
          title: fetchResult.title,
          description: fetchResult.description,
          duration_seconds: (fetchResult.metadata.duration_seconds as number) || null,
          thumbnail_url: (fetchResult.metadata.thumbnail_url as string) || null,
        });
      }

      const title = fetchResult.title || source.title;
      const description = fetchResult.description ?? source.description;
      const contentHash = sha256(fetchResult.rawContent);

      const pipelineConfig = {
        pool: this.pool,
        llmFn: (prompt: string) => this.llmService.complete(prompt),
        embedFn: (texts: string[]) => this.embeddingService.embed(texts),
      };

      // Use runPipelineFromSegments for all source types
      // (video sources pass VTT-parsed segments, non-video pass their own segments)
      const result: PipelineResult = await runPipelineFromSegments(
        source.source_id,
        title,
        description,
        sourceTypeToNodeType(source.source_type),
        fetchResult.segments,
        contentHash,
        pipelineConfig,
      );

      await this.sourceRepo.updateStatus(sourceId, 'completed');
      await this.sourceRepo.updateContentHash(sourceId, result.contentHash);
      await this.updateIngestLog(
        sourceId,
        'completed',
        7,
        null,
        null,
        result.segmentCount
      );

      logger.info(
        { sourceId, segmentCount: result.segmentCount },
        'Ingestion completed'
      );

      return {
        source_id: sourceId,
        status: 'completed',
        segment_count: result.segmentCount,
        content_hash: result.contentHash,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.sourceRepo.updateStatus(sourceId, 'failed');
      await this.updateIngestLog(sourceId, 'failed', 0, null, errorMessage);
      logger.error({ err, sourceId }, 'Ingestion failed');

      return {
        source_id: sourceId,
        status: 'failed',
        segment_count: 0,
        content_hash: '',
        error_message: errorMessage,
      };
    }
  }

  async getStatus(
    sourceId: string
  ): Promise<{
    status: IngestStatus;
    last_completed_stage: number | null;
    error_message: string | null;
  } | null> {
    const { rows } = await this.pool.query(
      'SELECT status, last_completed_stage, error_message FROM ingest_log WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1',
      [sourceId]
    );
    return (rows[0] as {
      status: IngestStatus;
      last_completed_stage: number | null;
      error_message: string | null;
    }) || null;
  }

  private async updateIngestLog(
    sourceId: string,
    status: IngestStatus,
    stage: number,
    stageName: string | null,
    errorMessage: string | null,
    segmentCount: number = 0
  ): Promise<void> {
    const { rows } = await this.pool.query(
      'SELECT id FROM ingest_log WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1',
      [sourceId]
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
           (source_id, content_hash, segment_count, status, last_completed_stage, stage_details, error_message)
         VALUES ($1, '', $2, $3, $4, $5, $6)`,
        [sourceId, segmentCount, status, stage, stageDetails, errorMessage]
      );
    }
  }
}
