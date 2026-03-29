import type { ContentSourceService, ContentFetchResult, ContentSegment } from './content-source.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export class TextSourceService implements ContentSourceService {
  constructor(private readonly uploadDir: string) {}

  async fetchContent(sourceId: string): Promise<ContentFetchResult> {
    // sourceId = uploaded file path or ID relative to uploadDir
    const filePath = path.resolve(this.uploadDir, sourceId);

    // Path traversal prevention
    if (!filePath.startsWith(path.resolve(this.uploadDir))) {
      throw new Error('Invalid source ID: path traversal detected');
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(sourceId).toLowerCase();

    const segments = this.splitIntoSegments(content);

    return {
      title: path.basename(sourceId, ext),
      description: null,
      metadata: { file_type: ext, file_size: content.length },
      segments,
      rawContent: content,
    };
  }

  private splitIntoSegments(content: string): ContentSegment[] {
    // Split by double newlines (paragraph-level segmentation)
    const paragraphs = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    return paragraphs.map((text, index) => ({
      text,
      start_ms: 0,
      end_ms: 0,
      sequence_index: index,
      speaker: null,
    }));
  }
}
