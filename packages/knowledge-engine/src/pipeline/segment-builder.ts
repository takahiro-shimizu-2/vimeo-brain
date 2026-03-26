import type { VttCue } from '../parsers/vtt-parser.js';
import { sha256 } from '../utils/hash.js';

export interface BuiltSegment {
  text: string;
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  content_hash: string;
}

const GAP_THRESHOLD_MS = 2000;

export function buildSegments(cues: VttCue[]): BuiltSegment[] {
  if (cues.length === 0) return [];

  const segments: BuiltSegment[] = [];
  let currentTexts: string[] = [cues[0].text];
  let currentStart = cues[0].start * 1000;
  let currentEnd = cues[0].end * 1000;
  let currentSpeaker = cues[0].speaker;

  for (let i = 1; i < cues.length; i++) {
    const cue = cues[i];
    const cueStartMs = cue.start * 1000;
    const cueEndMs = cue.end * 1000;
    const gap = cueStartMs - currentEnd;

    if (gap <= GAP_THRESHOLD_MS && (cue.speaker === currentSpeaker || cue.speaker === null)) {
      currentTexts.push(cue.text);
      currentEnd = cueEndMs;
    } else {
      const text = currentTexts.join(' ');
      segments.push({
        text,
        start_ms: Math.round(currentStart),
        end_ms: Math.round(currentEnd),
        sequence_index: segments.length,
        speaker: currentSpeaker,
        content_hash: sha256(text),
      });
      currentTexts = [cue.text];
      currentStart = cueStartMs;
      currentEnd = cueEndMs;
      currentSpeaker = cue.speaker;
    }
  }

  const text = currentTexts.join(' ');
  segments.push({
    text,
    start_ms: Math.round(currentStart),
    end_ms: Math.round(currentEnd),
    sequence_index: segments.length,
    speaker: currentSpeaker,
    content_hash: sha256(text),
  });

  return segments;
}
