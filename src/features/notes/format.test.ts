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

  it('strips block markers, because a preview is a summary and not a source view', () => {
    // This test asserted the OPPOSITE until 2026-08-26 — "the snippet is a
    // preview of raw Markdown" — and that rule was retired rather than
    // caveated, because on a real note it produced previews like
    // `hi | a | b | c | | --- | --- | --- |`.
    expect(deriveSnippet('Groceries\n## Dairy')).toBe('Dairy');
  });

  it('drops table rows entirely rather than stripping their pipes', () => {
    // The complaint that produced this. Cells are the shortest text in a note
    // and carry none of its sense; the prose around the table is the preview.
    const text = ['TEST', 'hi', '| a | b | c |', '| --- | --- | --- |', 'abcd'].join('\n');

    expect(deriveSnippet(text)).toBe('hi abcd');
  });

  it('drops a fenced code block’s delimiters', () => {
    expect(deriveSnippet('Note\nbefore\n```ts\nconst x = 1;\n```\nafter')).toBe(
      'before const x = 1; after',
    );
  });

  it.each([
    ['a bullet', 'Note\n- milk', 'milk'],
    ['a numbered item', 'Note\n1. milk', 'milk'],
    ['an unchecked task', 'Note\n- [ ] Rewrite the helper', 'Rewrite the helper'],
    ['a checked task', 'Note\n- [x] Rewrite the helper', 'Rewrite the helper'],
    ['a quote', 'Note\n> quoted', 'quoted'],
  ])('strips %s', (_what, text, expected) => {
    expect(deriveSnippet(text)).toBe(expected);
  });

  it('leaves a hash INSIDE prose alone, so a tag still reads as one', () => {
    // Only a LEADING marker is a block marker. A `#` mid-line is a tag or a
    // number sign and belongs in the preview.
    expect(deriveSnippet('Note\nplanning #work with **care**')).toBe('planning #work with care');
  });

  it('strips the inline HTML a coloured highlight serializes to', () => {
    // The complaint that produced this rule, verbatim from a real note: the
    // row printed `hi <mark class="hl-green">abcd</mark> hi, this is good.`
    // The tag is syntax; the words inside it are the note.
    const text = 'TEST\nhi <mark class="hl-green">abcd</mark> hi, this is good.';

    expect(deriveSnippet(text)).toBe('hi abcd hi, this is good.');
  });

  it.each([
    ['bold with asterisks', 'some **bold** here', 'some bold here'],
    ['bold with underscores', 'some __bold__ here', 'some bold here'],
    ['italic with an asterisk', 'some *soft* here', 'some soft here'],
    ['italic with an underscore', 'some _soft_ here', 'some soft here'],
    ['bold italic', 'some ***loud*** here', 'some loud here'],
    ['a code span', 'call `render()` twice', 'call render() twice'],
    ['a multi-backtick code span', 'call ``a ` b`` twice', 'call a ` b twice'],
    ['strikethrough', 'was ~~wrong~~ right', 'was wrong right'],
    ['a plain highlight', 'the ==important== bit', 'the important bit'],
    ['a coloured highlight', 'the <mark class="hl-blue">important</mark> bit', 'the important bit'],
    ['a link, keeping its text', 'see [the docs](https://example.com) now', 'see the docs now'],
    ['a bare autolink', 'see <https://example.com> now', 'see https://example.com now'],
    ['an escaped asterisk', 'a literal \\*star\\* here', 'a literal *star* here'],
    ['nested marks', '**bold with `code`** here', 'bold with code here'],
  ])('strips %s', (_what, body, expected) => {
    expect(deriveSnippet(`Note\n${body}`)).toBe(expected);
  });

  it('leaves an unpaired delimiter alone rather than eating the line', () => {
    // A half-typed `**` is text the user is in the middle of writing, not
    // syntax. Deleting one side of a pair would silently drop characters.
    expect(deriveSnippet('Note\n2 * 3 = 6 and a ** here')).toBe('2 * 3 = 6 and a ** here');
  });

  it('still finds a query that the stripping moved', () => {
    // `HighlightedText` searches the STRIPPED snippet for the query, so a
    // snippet chosen because it matched must still contain the match after
    // stripping — otherwise the row highlights nothing and reads as a false
    // positive. Selection therefore has to run on stripped lines too.
    const text = 'TEST\nhi <mark class="hl-green">abcd</mark> tail';

    expect(deriveSnippet(text, 'abcd')).toContain('abcd');
  });

  it('matches a query against the stripped text, not the raw syntax', () => {
    // Nobody searches for `<mark`, and a snippet is not a source view. With no
    // line matching, this falls through to the ordinary joined snippet — the
    // point being that the tag never selected a line on its own.
    expect(deriveSnippet('TEST\nplain body\nhi <mark>abcd</mark>', 'mark')).toBe(
      'plain body hi abcd',
    );
  });

  it('strips a callout marker but keeps its title', () => {
    // The title is the most informative text in the block; the marker is
    // syntax. Dropping the title would preview a warning as whatever
    // paragraph happened to follow it.
    expect(deriveSnippet('Note\n> [!warning] 백업 전에 확인\n>\n> 되돌릴 수 없습니다.')).toBe(
      '백업 전에 확인 되돌릴 수 없습니다.',
    );
  });

  it('strips an unrecognised marker too, because it is syntax either way', () => {
    expect(deriveSnippet('Note\n> [!사내공지] 제목\n>\n> 본문.')).toBe('제목 본문.');
  });

  it('keeps a bracketed phrase that is not a marker', () => {
    // `[!` only opens a marker at the very start of a block. Mid-line it is
    // prose, and eating it would delete the user's words.
    expect(deriveSnippet('Note\nsee [!important] below')).toBe('see [!important] below');
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
