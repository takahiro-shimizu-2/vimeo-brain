/**
 * Token budget management for LLM context windows.
 *
 * Pure functions with no external dependencies.
 * Provides heuristic token estimation and knapsack-style item selection
 * that fits within a given token budget.
 */

/** Result of selecting items within a token budget. */
export interface BudgetResult<T> {
  /** Items that fit within the budget. */
  selected: T[];
  /** Total tokens consumed by selected items. */
  totalTokens: number;
  /** Number of items that were excluded. */
  prunedCount: number;
}

/**
 * Returns true if the character falls within CJK Unicode ranges.
 *
 * Covered ranges:
 * - U+3000..U+9FFF  (CJK symbols, hiragana, katakana, unified ideographs)
 * - U+F900..U+FAFF  (CJK compatibility ideographs)
 */
function isCJKChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff);
}

/**
 * Estimate the number of tokens a text string would consume.
 *
 * Uses a heuristic per-character weight:
 * - CJK characters: 0.7 tokens each (they tokenise into fewer sub-words)
 * - Whitespace: 0 (treated as word boundaries only)
 * - Latin / other characters: 0.25 tokens each
 *
 * The result is rounded up via `Math.ceil`.
 */
export function estimateTokens(text: string): number {
  let total = 0;

  for (const char of text) {
    if (isCJKChar(char)) {
      total += 0.7;
    } else if (/\s/.test(char)) {
      // Whitespace is a word boundary — skip
      continue;
    } else {
      total += 0.25;
    }
  }

  return Math.ceil(total);
}

/**
 * Select items that fit within a token budget.
 *
 * Items are assumed to arrive in score-descending order.  The function
 * iterates through all items and greedily includes each one whose token
 * cost fits within the remaining budget.  Items that exceed the remaining
 * budget are skipped (not short-circuited) so that smaller items further
 * down the list still have a chance to be included.
 *
 * @param items    - Candidate items, ordered by relevance (best first).
 * @param getText  - Accessor that extracts the text content from an item.
 * @param maxTokens - Maximum token budget.
 * @returns A {@link BudgetResult} with the selected items, total token
 *          usage, and the count of pruned (excluded) items.
 */
export function selectWithinBudget<T>(
  items: T[],
  getText: (item: T) => string,
  maxTokens: number,
): BudgetResult<T> {
  const selected: T[] = [];
  let totalTokens = 0;

  for (const item of items) {
    const itemTokens = estimateTokens(getText(item));

    if (totalTokens + itemTokens <= maxTokens) {
      selected.push(item);
      totalTokens += itemTokens;
    }
    // Intentionally continue — do not break.
    // A later, smaller item may still fit within the remaining budget.
  }

  return {
    selected,
    totalTokens,
    prunedCount: items.length - selected.length,
  };
}
