import webvtt from 'node-webvtt';

export interface VttCue {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  identifier: string;
}

export interface ParsedVtt {
  cues: VttCue[];
  rawContent: string;
}

interface WebVttCue {
  identifier: string;
  start: number;
  end: number;
  text: string;
  styles: string;
}

interface WebVttResult {
  cues: WebVttCue[];
  valid: boolean;
}

export function parseVtt(content: string): ParsedVtt {
  const result: WebVttResult = webvtt.parse(content, { meta: false });

  const cues: VttCue[] = result.cues.map((cue) => {
    const { speaker, cleanText } = extractSpeaker(cue.text);
    return {
      start: cue.start,
      end: cue.end,
      text: cleanText.trim(),
      speaker,
      identifier: cue.identifier || '',
    };
  });

  return { cues, rawContent: content };
}

function extractSpeaker(text: string): { speaker: string | null; cleanText: string } {
  // Pattern 1: <v Speaker Name>text</v>
  const vTagMatch = text.match(/^<v\s+([^>]+)>([\s\S]*?)<\/v>$/);
  if (vTagMatch) {
    return { speaker: vTagMatch[1].trim(), cleanText: vTagMatch[2] };
  }

  // Pattern 2: "Speaker: text" or "Speaker Name: text"
  const colonMatch = text.match(/^([A-Z][A-Za-z\s.]+?):\s+([\s\S]+)$/);
  if (colonMatch) {
    return { speaker: colonMatch[1].trim(), cleanText: colonMatch[2] };
  }

  // Pattern 3: [Speaker] text
  const bracketMatch = text.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
  if (bracketMatch) {
    return { speaker: bracketMatch[1].trim(), cleanText: bracketMatch[2] };
  }

  return { speaker: null, cleanText: text };
}
