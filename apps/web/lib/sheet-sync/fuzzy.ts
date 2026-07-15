// Fuzzy material matching for the guided estimate, custom build, and
// shop-order searches. Tolerates misspellings ("durrabond", "coroplastt"),
// partial words, reordered tokens, and Sheet ALIASES. Pure TS — safe on
// the client, unit-testable.

export interface FuzzyCandidate<T> {
  item: T;
  score: number;
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[×x]/g, 'x')
    .replace(/[^a-z0-9/."']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/// Character-bigram Dice coefficient — cheap and typo-tolerant.
function bigrams(word: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < word.length - 1; i += 1) {
    const bg = word.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of aBigrams) {
    const other = bBigrams.get(bg);
    if (other) overlap += Math.min(count, other);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/// Score one query token against a haystack's tokens: exact > prefix >
/// substring > bigram similarity.
function tokenScore(queryToken: string, hayTokens: string[]): number {
  let best = 0;
  for (const hay of hayTokens) {
    if (hay === queryToken) return 1;
    if (hay.startsWith(queryToken)) best = Math.max(best, 0.9);
    else if (hay.includes(queryToken)) best = Math.max(best, 0.75);
    else best = Math.max(best, diceSimilarity(queryToken, hay) * 0.85);
  }
  return best;
}

/// Fuzzy-match a query against candidates. `haystack(item)` returns the
/// searchable text; `aliases` maps misspelling → canonical text appended
/// to the query when it matches. Returns candidates scoring above the
/// threshold, best first.
export function fuzzySearch<T>(
  query: string,
  items: ReadonlyArray<T>,
  haystack: (item: T) => string,
  opts: {
    limit?: number;
    threshold?: number;
    aliases?: ReadonlyArray<{ alias: string; canonical: string }>;
  } = {}
): T[] {
  const limit = opts.limit ?? 25;
  const threshold = opts.threshold ?? 0.55;
  const rawQuery = normalize(query);
  if (!rawQuery) return [];

  // Alias expansion: if the whole query (or a token) matches a known
  // alias, search for the canonical name too.
  let expanded = rawQuery;
  for (const a of opts.aliases ?? []) {
    const alias = normalize(a.alias);
    if (!alias) continue;
    if (rawQuery === alias || rawQuery.includes(alias) || diceSimilarity(rawQuery, alias) >= 0.8) {
      expanded = `${rawQuery} ${normalize(a.canonical)}`;
      break;
    }
  }

  const queryTokens = Array.from(new Set(expanded.split(' ').filter(Boolean)));
  if (queryTokens.length === 0) return [];

  const scored: Array<FuzzyCandidate<T>> = [];
  for (const item of items) {
    const hayNorm = normalize(haystack(item));
    if (!hayNorm) continue;
    const baseTokens = hayNorm.split(' ');
    // Also match against joined adjacent tokens so "durrabond" finds
    // "Dura-Bond" (hyphenated/spaced words typed as one).
    const hayTokens = [...baseTokens];
    for (let i = 0; i < baseTokens.length - 1; i += 1) {
      hayTokens.push(`${baseTokens[i]}${baseTokens[i + 1]}`);
    }

    // Whole-query substring is a very strong signal.
    let score: number;
    if (hayNorm.includes(rawQuery)) {
      score = 0.98;
    } else {
      let sum = 0;
      for (const qt of queryTokens) sum += tokenScore(qt, hayTokens);
      score = sum / queryTokens.length;
    }
    if (score >= threshold) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((c) => c.item);
}
