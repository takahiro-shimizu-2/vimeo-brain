/**
 * Japanese text preprocessor for Full-Text Search queries.
 *
 * Pure functions only -- no external dependencies.
 * Handles CJK detection, particle removal, bigram generation, and
 * tsquery string construction for PostgreSQL FTS.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreprocessedQuery {
  /** Original query string */
  original: string;
  /** After particle removal */
  cleaned: string;
  /** CJK bigram array */
  bigrams: string[];
  /** Space-split tokens (after particle removal) */
  tokens: string[];
  /** For plainto_tsquery (= cleaned) */
  tsqueryRaw: string;
  /** For to_tsquery (bigram1 & bigram2 & ...) */
  tsqueryBigram: string;
  /** For to_tsquery (token1 | token2 | ...) */
  tsqueryOr: string;
  /** Whether text is CJK */
  isCJK: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the character falls within CJK Unicode ranges.
 *
 * Covered ranges:
 *   U+3000 - U+9FFF  (CJK Symbols, Hiragana, Katakana, CJK Unified Ideographs)
 *   U+F900 - U+FAFF  (CJK Compatibility Ideographs)
 */
function isCJKChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Check whether CJK characters make up at least 30 % of the total characters
 * in `text` (whitespace excluded from counting).
 */
export function isCJKText(text: string): boolean {
  const chars = [...text].filter((c) => c.trim().length > 0);
  if (chars.length === 0) return false;

  const cjkCount = chars.filter(isCJKChar).length;
  return cjkCount / chars.length >= 0.3;
}

/**
 * Remove common Japanese particles from the text.
 *
 * NOTE: Known limitation -- this naive regex also strips these characters
 * when they appear as part of kanji / katakana words (e.g. the 「は」 in
 * 「始まり」). A proper morphological analyser (MeCab / kuromoji) would be
 * needed for accurate particle-only removal.
 */
export function removeParticles(text: string): string {
  return text.replace(/[をはがのでにへともか]/g, '');
}

/**
 * Generate overlapping bigrams from CJK characters in `text`.
 *
 * Non-CJK characters are skipped; bigrams are built from the remaining
 * contiguous CJK sequence.
 *
 * Example: "動画内容" -> ["動画", "画内", "内容"]
 */
export function generateBigrams(text: string): string[] {
  const cjkChars = [...text].filter(isCJKChar);
  const bigrams: string[] = [];

  for (let i = 0; i < cjkChars.length - 1; i++) {
    bigrams.push(cjkChars[i] + cjkChars[i + 1]);
  }

  return bigrams;
}

/**
 * Main preprocessing entry-point.
 *
 * Orchestrates CJK detection, particle removal, bigram generation, and
 * tsquery string construction.
 */
export function preprocessQuery(query: string): PreprocessedQuery {
  const original = query.trim();
  const cjk = isCJKText(original);
  const cleaned = cjk ? removeParticles(original) : original;
  const bigrams = cjk ? generateBigrams(cleaned) : [];
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);

  return {
    original,
    cleaned,
    bigrams,
    tokens,
    tsqueryRaw: cleaned,
    tsqueryBigram: bigrams.join(' & '),
    tsqueryOr: tokens.join(' | '),
    isCJK: cjk,
  };
}
