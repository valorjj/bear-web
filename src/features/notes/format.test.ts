import { describe, expect, it } from 'vitest';

import { deriveSnippet, formatNoteDate } from './format';

describe('deriveSnippet', () => {
  it('is empty for an empty note', () => {
    expect(deriveSnippet('')).toBe('');
  });

  it('is empty for a note with only a title line', () => {
    expect(deriveSnippet('Groceries')).toBe('');
  });

  it('returns the first non-empty line after the title line', () => {
    expect(deriveSnippet('Groceries\n\nmilk, bread, coffee')).toBe('milk, bread, coffee');
  });

  it('skips the heading that deriveTitle consumed', () => {
    expect(deriveSnippet('# Groceries\nmilk')).toBe('milk');
  });

  it('trims surrounding whitespace on both the title and the snippet lines', () => {
    expect(deriveSnippet('\n\n   Groceries   \n\n   milk   \n')).toBe('milk');
  });

  it('leaves Markdown syntax in the snippet alone', () => {
    // The snippet is a preview of raw Markdown, not rendered output. Only
    // `deriveTitle` strips heading syntax, and only from the title line.
    expect(deriveSnippet('Groceries\n## Dairy')).toBe('## Dairy');
  });
});

describe('formatNoteDate', () => {
  const locale = 'en-US';
  const now = new Date(2026, 7, 8, 9, 0).getTime(); // 2026-08-08 09:00 local

  it('shows a 24-hour clock time for a note updated today', () => {
    const today = new Date(2026, 7, 8, 14, 32).getTime();
    expect(formatNoteDate(today, locale, now)).toBe('14:32');
  });

  it('shows a calendar date for a note updated on another day', () => {
    const earlier = new Date(2026, 7, 6, 14, 32).getTime();
    expect(formatNoteDate(earlier, locale, now)).toBe('Aug 6, 2026');
  });

  it('treats the same calendar day in a different year as another day', () => {
    const lastYear = new Date(2025, 7, 8, 14, 32).getTime();
    expect(formatNoteDate(lastYear, locale, now)).toBe('Aug 8, 2025');
  });
});
