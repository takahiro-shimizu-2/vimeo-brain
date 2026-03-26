import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../errors/app-error.js';
import type { VideoSourceService, VideoMetadata } from './video-source.js';

/** Lazily import the ESM-only youtube-transcript package. */
async function getYoutubeTranscript() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const mod = await (new Function('return import("youtube-transcript")')() as Promise<{
    YoutubeTranscript: {
      fetchTranscript(videoId: string): Promise<Array<{ text: string; offset: number; duration: number }>>;
    };
  }>);
  return mod.YoutubeTranscript;
}

/**
 * Convert ISO 8601 duration (e.g. "PT1H2M3S") to seconds.
 */
function parseIsoDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds as VTT timestamp (HH:MM:SS.mmm).
 */
function formatVttTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(whole).padStart(2, '0') +
    '.' +
    String(ms).padStart(3, '0')
  );
}

interface TranscriptItem {
  text: string;
  offset: number;
  duration: number;
}

interface YouTubeDataApiSnippet {
  title: string;
  description: string;
  thumbnails: { high?: { url: string }; default?: { url: string } };
}

interface YouTubeDataApiContentDetails {
  duration: string;
}

interface YouTubeDataApiItem {
  snippet: YouTubeDataApiSnippet;
  contentDetails: YouTubeDataApiContentDetails;
}

interface YouTubeDataApiResponse {
  items: YouTubeDataApiItem[];
}

interface YouTubeOEmbedResponse {
  title: string;
  thumbnail_url: string;
}

export class YouTubeService implements VideoSourceService {
  /**
   * Fetch transcript from YouTube and convert to VTT format.
   */
  async getTranscriptVtt(videoId: string): Promise<string> {
    logger.info({ videoId }, 'Fetching YouTube transcript');

    let items: TranscriptItem[];
    try {
      const YoutubeTranscript = await getYoutubeTranscript();
      items = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (err) {
      throw AppError.internal(
        `Failed to fetch YouTube transcript for ${videoId}: ${(err as Error).message}`,
      );
    }

    if (!items || items.length === 0) {
      throw AppError.internal(`No transcript available for YouTube video ${videoId}`);
    }

    // Unit normalization: if first item offset > 1000, values are in milliseconds
    const isMilliseconds = items[0].offset > 1000;
    const divisor = isMilliseconds ? 1000 : 1;

    let vtt = 'WEBVTT\n\n';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const startSec = item.offset / divisor;
      const endSec = startSec + item.duration / divisor;
      vtt += `${i + 1}\n`;
      vtt += `${formatVttTime(startSec)} --> ${formatVttTime(endSec)}\n`;
      vtt += `${item.text}\n\n`;
    }

    return vtt;
  }

  /**
   * Fetch video metadata from YouTube.
   * Uses Data API v3 if YOUTUBE_API_KEY is configured, otherwise falls back to oEmbed.
   */
  async getMetadata(videoId: string): Promise<VideoMetadata> {
    if (config.YOUTUBE_API_KEY) {
      return this.getMetadataFromDataApi(videoId);
    }
    return this.getMetadataFromOEmbed(videoId);
  }

  private async getMetadataFromDataApi(videoId: string): Promise<VideoMetadata> {
    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}` +
      `&key=${config.YOUTUBE_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw AppError.internal(`YouTube Data API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as YouTubeDataApiResponse;
    if (!data.items || data.items.length === 0) {
      throw AppError.notFound(`YouTube video not found: ${videoId}`);
    }

    const item = data.items[0];
    const snippet = item.snippet;
    const thumbnailUrl =
      snippet.thumbnails.high?.url || snippet.thumbnails.default?.url || null;

    return {
      title: snippet.title,
      description: snippet.description || null,
      duration_seconds: parseIsoDuration(item.contentDetails.duration),
      thumbnail_url: thumbnailUrl,
    };
  }

  private async getMetadataFromOEmbed(videoId: string): Promise<VideoMetadata> {
    const url =
      `https://www.youtube.com/oembed` +
      `?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}` +
      `&format=json`;

    const res = await fetch(url);
    if (!res.ok) {
      throw AppError.internal(`YouTube oEmbed API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as YouTubeOEmbedResponse;

    return {
      title: data.title,
      description: null,
      duration_seconds: 0,
      thumbnail_url: data.thumbnail_url || null,
    };
  }
}
