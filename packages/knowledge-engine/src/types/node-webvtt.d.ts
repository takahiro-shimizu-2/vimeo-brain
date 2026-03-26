declare module 'node-webvtt' {
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

  interface ParseOptions {
    meta?: boolean;
    strict?: boolean;
  }

  function parse(input: string, options?: ParseOptions): WebVttResult;
  function compile(input: WebVttResult): string;

  export default { parse, compile };
}
