import { normalizeForSearch } from '@/features/notes';

/** The minimum a thing needs to be rankable: a stable id and a display label. */
export interface Matchable {
  id: string;
  label: string;
}

export interface MatchQuality {
  /** The label begins with the query. The strongest signal. */
  startsWith: boolean;
  /** Every matched character landed on a word boundary. */
  allBoundary: boolean;
  /** How many matched characters landed on a word boundary. */
  boundaryCount: number;
  /** First to last matched character, inclusive. Tighter is better. */
  span: number;
  /** Label length. Shorter is better, all else equal. */
  length: number;
}

/** A character is on a boundary if it opens the label or follows one of these. */
const BOUNDARIES = new Set([' ', '/', '-', ':']);

/**
 * How well `query` matches `label`, or `null` if it does not match at all.
 *
 * A match means the query's characters appear in the label IN ORDER — a
 * subsequence, not a substring, so `epdf` finds "Export as PDF". Both sides
 * fold through `normalizeForSearch`, which is NFC + lowercase, so this works
 * in Korean as well as English.
 *
 * The scan is greedy: it takes the first available position for each query
 * character rather than searching for the tightest possible arrangement.
 * Greedy is not always span-optimal, but it is O(n), deterministic, and the
 * difference cannot be seen on labels this short.
 */
export function matchOne(label: string, query: string): MatchQuality | null {
  const haystack = normalizeForSearch(label);
  const needle = normalizeForSearch(query.trim());

  if (needle === '') {
    return { startsWith: true, allBoundary: true, boundaryCount: 0, span: 0, length: label.length };
  }

  let qi = 0;
  let first = -1;
  let last = -1;
  let boundaryCount = 0;
  let allBoundary = true;

  for (let i = 0; i < haystack.length && qi < needle.length; i += 1) {
    if (haystack[i] !== needle[qi]) continue;

    const onBoundary = i === 0 || BOUNDARIES.has(haystack[i - 1]!);
    if (onBoundary) boundaryCount += 1;
    else allBoundary = false;

    if (first === -1) first = i;
    last = i;
    qi += 1;
  }

  if (qi < needle.length) return null;

  return {
    startsWith: haystack.startsWith(needle),
    allBoundary,
    boundaryCount,
    span: last - first + 1,
    length: label.length,
  };
}

/** Negative if `a` should rank before `b`. The spec's six rules, in order. */
function compare(a: MatchQuality, b: MatchQuality, aId: string, bId: string): number {
  if (a.startsWith !== b.startsWith) return a.startsWith ? -1 : 1;
  if (a.allBoundary !== b.allBoundary) return a.allBoundary ? -1 : 1;
  if (a.boundaryCount !== b.boundaryCount) return b.boundaryCount - a.boundaryCount;
  if (a.span !== b.span) return a.span - b.span;
  if (a.length !== b.length) return a.length - b.length;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * The matching items, best first.
 *
 * Rule 6 — the `id` tie-break — is not decoration. Without it two equally
 * good matches would order by whatever `sort` happened to do, which makes the
 * highlighted row move between renders and makes the tests unassertable.
 */
export function matchAll<T extends Matchable>(items: readonly T[], query: string): T[] {
  if (query.trim() === '') {
    // For empty queries, return all items sorted by id only
    return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const scored: { item: T; quality: MatchQuality }[] = [];

  for (const item of items) {
    const quality = matchOne(item.label, query);
    if (quality !== null) scored.push({ item, quality });
  }

  scored.sort((a, b) => compare(a.quality, b.quality, a.item.id, b.item.id));
  return scored.map((entry) => entry.item);
}
