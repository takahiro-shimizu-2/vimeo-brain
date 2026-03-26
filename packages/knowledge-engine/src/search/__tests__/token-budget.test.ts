import { describe, it, expect } from 'vitest';
import { estimateTokens, selectWithinBudget } from '../token-budget.js';

describe('estimateTokens', () => {
  it('estimates CJK text at ~0.7 tokens per char', () => {
    // "動画内容" = 4 CJK chars × 0.7 = 2.8 → ceil = 3
    expect(estimateTokens('動画内容')).toBe(3);
  });

  it('estimates Latin text at ~0.25 tokens per char', () => {
    // "hello" = 5 Latin chars × 0.25 = 1.25 → ceil = 2
    expect(estimateTokens('hello')).toBe(2);
  });

  it('skips whitespace', () => {
    // "a b" = 2 Latin chars × 0.25 = 0.5 → ceil = 1
    expect(estimateTokens('a b')).toBe(1);
  });

  it('handles mixed CJK and Latin', () => {
    // "A動画B" = 2 Latin(0.5) + 2 CJK(1.4) = 1.9 → ceil = 2
    expect(estimateTokens('A動画B')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for whitespace only', () => {
    expect(estimateTokens('   ')).toBe(0);
  });
});

describe('selectWithinBudget', () => {
  interface Item {
    text: string;
    score: number;
  }

  const getText = (item: Item) => item.text;

  it('selects items within budget', () => {
    const items: Item[] = [
      { text: 'short', score: 1 },
      { text: 'medium text here', score: 0.8 },
    ];
    // "short" = ceil(5*0.25) = 2, "medium text here" = ceil(14*0.25) = 4
    const result = selectWithinBudget(items, getText, 10);
    expect(result.selected).toEqual(items);
    expect(result.prunedCount).toBe(0);
  });

  it('prunes items that exceed budget', () => {
    const items: Item[] = [
      { text: '動画内容についての説明文', score: 1 },     // ~8 CJK chars after particles = ceil(8*0.7) ≈ 6+
      { text: 'a', score: 0.5 },                         // ceil(0.25) = 1
    ];
    const result = selectWithinBudget(items, getText, 3);
    // First item exceeds budget, second fits
    expect(result.selected.length).toBe(1);
    expect(result.selected[0].text).toBe('a');
    expect(result.prunedCount).toBe(1);
  });

  it('does not break on over-budget items (continue strategy)', () => {
    const items: Item[] = [
      { text: 'tiny', score: 1 },                         // ceil(4*0.25) = 1
      { text: '動画内容についての長い説明文テスト', score: 0.9 }, // large
      { text: 'ok', score: 0.5 },                          // ceil(2*0.25) = 1
    ];
    const result = selectWithinBudget(items, getText, 3);
    // "tiny" fits (1), large item skipped, "ok" fits (1+1=2)
    expect(result.selected.length).toBe(2);
    expect(result.selected[0].text).toBe('tiny');
    expect(result.selected[1].text).toBe('ok');
    expect(result.prunedCount).toBe(1);
  });

  it('handles empty items array', () => {
    const result = selectWithinBudget([], getText, 100);
    expect(result.selected).toEqual([]);
    expect(result.totalTokens).toBe(0);
    expect(result.prunedCount).toBe(0);
  });

  it('handles zero budget', () => {
    const items: Item[] = [{ text: 'hello', score: 1 }];
    const result = selectWithinBudget(items, getText, 0);
    expect(result.selected).toEqual([]);
    expect(result.prunedCount).toBe(1);
  });

  it('tracks total tokens correctly', () => {
    const items: Item[] = [
      { text: 'aa', score: 1 },   // ceil(2*0.25) = 1
      { text: 'bb', score: 0.9 }, // ceil(2*0.25) = 1
    ];
    const result = selectWithinBudget(items, getText, 10);
    expect(result.totalTokens).toBe(2);
  });
});
