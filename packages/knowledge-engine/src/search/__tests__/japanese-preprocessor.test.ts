import { describe, it, expect } from 'vitest';
import {
  isCJKChar,
  isCJKText,
  removeParticles,
  generateBigrams,
  preprocessQuery,
} from '../japanese-preprocessor.js';

describe('isCJKChar', () => {
  it('returns true for kanji', () => {
    expect(isCJKChar('動')).toBe(true);
    expect(isCJKChar('画')).toBe(true);
  });

  it('returns true for hiragana', () => {
    expect(isCJKChar('あ')).toBe(true);
    expect(isCJKChar('を')).toBe(true);
  });

  it('returns true for katakana', () => {
    expect(isCJKChar('ア')).toBe(true);
    expect(isCJKChar('ン')).toBe(true);
  });

  it('returns false for Latin characters', () => {
    expect(isCJKChar('a')).toBe(false);
    expect(isCJKChar('Z')).toBe(false);
    expect(isCJKChar('1')).toBe(false);
  });

  it('returns false for spaces and punctuation', () => {
    expect(isCJKChar(' ')).toBe(false);
    expect(isCJKChar('.')).toBe(false);
  });
});

describe('isCJKText', () => {
  it('returns true when CJK chars >= 30%', () => {
    expect(isCJKText('動画の内容について')).toBe(true);
  });

  it('returns true for mixed text with enough CJK', () => {
    // "ABC動画" — 2 CJK out of 5 non-space chars = 40%
    expect(isCJKText('ABC動画')).toBe(true);
  });

  it('returns false for pure Latin text', () => {
    expect(isCJKText('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCJKText('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(isCJKText('   ')).toBe(false);
  });

  it('ignores whitespace in percentage calculation', () => {
    // "a b c d 動" — 1 CJK out of 5 non-space chars = 20% < 30%
    expect(isCJKText('a b c d 動')).toBe(false);
  });
});

describe('removeParticles', () => {
  it('removes Japanese particles', () => {
    expect(removeParticles('動画を見て')).toBe('動画見て');
    // Known limitation: 「か」in「ですか」is also removed as a particle
    expect(removeParticles('これは何ですか')).toBe('これ何す');
  });

  it('removes multiple particles', () => {
    // 「は」and「に」are both removed
    expect(removeParticles('私は学校に行く')).toBe('私学校行く');
  });

  it('does not modify Latin text', () => {
    expect(removeParticles('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(removeParticles('')).toBe('');
  });
});

describe('generateBigrams', () => {
  it('generates overlapping bigrams from CJK text', () => {
    expect(generateBigrams('動画内容')).toEqual(['動画', '画内', '内容']);
  });

  it('skips non-CJK characters', () => {
    // "A動画B内容" → CJK chars are 動画内容 → bigrams: 動画, 画内, 内容
    expect(generateBigrams('A動画B内容')).toEqual(['動画', '画内', '内容']);
  });

  it('returns empty array for single CJK char', () => {
    expect(generateBigrams('動')).toEqual([]);
  });

  it('returns single bigram for two CJK chars', () => {
    expect(generateBigrams('動画')).toEqual(['動画']);
  });

  it('returns empty array for empty string', () => {
    expect(generateBigrams('')).toEqual([]);
  });

  it('returns empty array for non-CJK text', () => {
    expect(generateBigrams('hello')).toEqual([]);
  });
});

describe('preprocessQuery', () => {
  it('handles Japanese query', () => {
    const result = preprocessQuery('動画の内容について');
    expect(result.original).toBe('動画の内容について');
    expect(result.isCJK).toBe(true);
    // particles removed: の, に
    expect(result.cleaned).not.toContain('の');
    expect(result.bigrams.length).toBeGreaterThan(0);
    expect(result.tsqueryBigram).toContain(' & ');
  });

  it('handles English query', () => {
    const result = preprocessQuery('video content overview');
    expect(result.original).toBe('video content overview');
    expect(result.isCJK).toBe(false);
    expect(result.cleaned).toBe('video content overview');
    expect(result.bigrams).toEqual([]);
    expect(result.tsqueryBigram).toBe('');
    expect(result.tokens).toEqual(['video', 'content', 'overview']);
    expect(result.tsqueryOr).toBe('video | content | overview');
  });

  it('trims whitespace', () => {
    const result = preprocessQuery('  hello  ');
    expect(result.original).toBe('hello');
  });

  it('handles empty query', () => {
    const result = preprocessQuery('');
    expect(result.original).toBe('');
    expect(result.tokens).toEqual([]);
    expect(result.tsqueryOr).toBe('');
  });

  it('generates tsqueryRaw as cleaned text', () => {
    const result = preprocessQuery('動画を見る');
    expect(result.tsqueryRaw).toBe(result.cleaned);
  });
});
