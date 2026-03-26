import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../errors/app-error.js';

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

export class VimeoService {
  private token: string;

  constructor() {
    if (!config.VIMEO_ACCESS_TOKEN) {
      throw new Error('VIMEO_ACCESS_TOKEN is required');
    }
    this.token = config.VIMEO_ACCESS_TOKEN;
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
}
