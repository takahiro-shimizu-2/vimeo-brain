import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../errors/app-error.js';
import type { VideoSourceService, VideoMetadata } from './video-source.js';

export interface VimeoVideo {
  uri: string;
  name: string;
  description: string | null;
  duration: number;
  pictures: { sizes: Array<{ link: string; width: number }> };
}

export interface VimeoTextTrack {
  uri: string;
  type: string;
  language: string;
  link: string;
}

const VIMEO_API = 'https://api.vimeo.com';

export class VimeoService implements VideoSourceService {
  private get token(): string {
    if (!config.VIMEO_ACCESS_TOKEN) {
      throw AppError.internal('VIMEO_ACCESS_TOKEN is not configured');
    }
    return config.VIMEO_ACCESS_TOKEN;
  }

  private async request<T>(path: string): Promise<T> {
    let retries = 3;
    let delay = 1000;

    while (retries > 0) {
      const res = await fetch(`${VIMEO_API}${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.vimeo.*+json;version=3.4',
        },
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : delay;
        logger.warn({ path, waitMs }, 'Vimeo rate limit, retrying');
        await new Promise((r) => setTimeout(r, waitMs));
        retries--;
        delay *= 2;
        continue;
      }

      if (!res.ok) {
        throw AppError.internal(`Vimeo API error: ${res.status} ${res.statusText}`);
      }

      return res.json() as Promise<T>;
    }

    throw AppError.internal('Vimeo API rate limit exceeded after retries');
  }

  async getVideo(vimeoId: string): Promise<VimeoVideo> {
    return this.request<VimeoVideo>(`/videos/${vimeoId}`);
  }

  async getTextTracks(vimeoId: string): Promise<VimeoTextTrack[]> {
    const result = await this.request<{ data: VimeoTextTrack[] }>(
      `/videos/${vimeoId}/texttracks`
    );
    return result.data;
  }

  async downloadVtt(trackLink: string): Promise<string> {
    const res = await fetch(trackLink);
    if (!res.ok) {
      throw AppError.internal(`Failed to download VTT: ${res.status}`);
    }
    return res.text();
  }

  /** VideoSourceService implementation: fetch metadata for a Vimeo video. */
  async getMetadata(sourceId: string): Promise<VideoMetadata> {
    const video = await this.getVideo(sourceId);
    const thumbnail =
      video.pictures?.sizes?.length > 0
        ? video.pictures.sizes[video.pictures.sizes.length - 1].link
        : null;
    return {
      title: video.name,
      description: video.description,
      duration_seconds: video.duration,
      thumbnail_url: thumbnail,
    };
  }

  /** VideoSourceService implementation: fetch VTT transcript for a Vimeo video. */
  async getTranscriptVtt(sourceId: string): Promise<string> {
    const tracks = await this.getTextTracks(sourceId);
    if (tracks.length === 0) {
      throw AppError.internal(`No text tracks found for Vimeo video ${sourceId}`);
    }
    return this.downloadVtt(tracks[0].link);
  }
}
