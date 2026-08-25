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

  it('joins the body lines into one run of prose', () => {
    // The row clamps to two lines and reserves the height whether or not
    // there is text to fill it, so a preview that stopped at the first body
    // line left half of that reserved space permanently blank.
    expect(deriveSnippet('Groceries\nmilk\nbread\ncoffee')).toBe('milk bread coffee');
  });

  it('closes up the blank lines between paragraphs when joining', () => {
    expect(deriveSnippet('Trip\n\nDay one.\n\nDay two.')).toBe('Day one. Day two.');
  });

  it('caps the joined body so the accessible name cannot read out a whole note', () => {
    const snippet = deriveSnippet(`Long\n${'word '.repeat(200)}`);

    expect(snippet.length).toBeLessThanOrEqual(240);
    expect(snippet.startsWith('word word')).toBe(true);
  });

  it('drops image syntax, which the row draws as a thumbnail instead', () => {
    expect(deriveSnippet('Trip\n![beach](https://example.com/a.png)\nwe went last week')).toBe(
      'we went last week',
    );
  });

  it('keeps the prose around an inline image', () => {
    expect(deriveSnippet('Trip\nbefore ![a](https://example.com/a.png) after')).toBe(
      'before after',
    );
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

describe('midnight', () => {
  it('renders midnight as 00:xx, never 24:xx', () => {
    // The documented reason for choosing hourCycle: 'h23' over hour12: false.
    // Under some ICU builds the latter renders midnight as 24:00.
    const midnight = new Date(2026, 0, 15, 0, 30).getTime();
    const sameDay = new Date(2026, 0, 15, 9, 0).getTime();

    const rendered = formatNoteDate(midnight, 'en', sameDay);

    expect(rendered).toContain('00:30');
    expect(rendered).not.toContain('24:30');
  });
});

describe('deriveSnippet with a query', () => {
  const text = 'Groceries\nfirst line\nsecond line\nmilk and bread';

  it('is unchanged when no query is given', () => {
    expect(deriveSnippet(text)).toBe('first line second line milk and bread');
  });

  it('is unchanged when the query is blank', () => {
    expect(deriveSnippet(text, '  ')).toBe('first line second line milk and bread');
  });

  it('returns the first line containing the match', () => {
    expect(deriveSnippet(text, 'milk')).toBe('milk and bread');
  });

  it('matches case-insensitively', () => {
    expect(deriveSnippet(text, 'MILK')).toBe('milk and bread');
  });

  // When the title is the ONLY match, repeating it as the snippet would
  // print the same text twice (the title already renders, highlighted, above
  // the snippet) with its raw syntax exposed. Falls back to the ordinary
  // snippet instead, exactly like the no-query path.
  it('does not repeat the title as the snippet when the title is the only match', () => {
    expect(deriveSnippet(text, 'Groceries')).toBe('first line second line milk and bread');
  });

  // The paired case: a match on the title line does NOT suppress a genuine
  // body-line match elsewhere — this fixture's title itself contains no
  // separate body occurrence, so cover the case where both lines match.
  it('keeps the title-line match when a body line matches too', () => {
    expect(deriveSnippet('Groceries about milk\nfirst line\nmilk and bread', 'milk')).toBe(
      'Groceries about milk',
    );
  });

  it('falls back to the ordinary snippet when a title-only match has no body line to show', () => {
    expect(deriveSnippet('Groceries', 'Groceries')).toBe('');
  });

  it('falls back to the ordinary snippet when nothing matches', () => {
    expect(deriveSnippet(text, 'zzz')).toBe('first line second line milk and bread');
  });
});
