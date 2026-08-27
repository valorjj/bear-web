import { describe, expect, it } from 'vitest';

import { CALLOUT_TYPES, formatMarker, parseMarker } from './callouts';

describe('parseMarker', () => {
  it('declines text with no marker', () => {
    expect(parseMarker('just prose')).toBeNull();
  });

  it('reads a type and a title', () => {
    expect(parseMarker('[!warning] Be careful')).toEqual({
      type: 'warning',
      raw: 'warning',
      title: 'Be careful',
      rest: '',
    });
  });

  it('splits the tight form at the first newline', () => {
    // Obsidian and GitHub both write `> [!warning] T` / `> Body.` with no
    // blank `>` between, and the parser renders that as ONE paragraph whose
    // text carries a hard newline — verified against the real pipeline on
    // 2026-08-27. Without this split the body would become part of the title.
    expect(parseMarker('[!warning] Title\nBody.')).toEqual({
      type: 'warning',
      raw: 'warning',
      title: 'Title',
      rest: 'Body.',
    });
  });

  it('keeps later newlines in the body rather than splitting again', () => {
    expect(parseMarker('[!tip] T\nfirst\nsecond')?.rest).toBe('first\nsecond');
  });

  it('accepts an untitled marker', () => {
    expect(parseMarker('[!tip]')).toEqual({ type: 'tip', raw: 'tip', title: '', rest: '' });
  });

  it.each([
    ['note', 'info'],
    ['INFO', 'info'],
    ['abstract', 'info'],
    ['summary', 'info'],
    ['hint', 'tip'],
    ['Important', 'tip'],
    ['check', 'success'],
    ['done', 'success'],
    ['caution', 'warning'],
    ['ATTENTION', 'warning'],
    ['error', 'danger'],
    ['failure', 'danger'],
    ['bug', 'danger'],
  ])('normalizes the alias %s to %s', (alias, expected) => {
    expect(parseMarker(`[!${alias}] T`)?.type).toBe(expected);
  });

  it.each(CALLOUT_TYPES)('accepts %s, its own canonical spelling', (type) => {
    // The roster and the alias table are separate sources; this is what stops
    // them disagreeing about what a canonical word means.
    expect(parseMarker(`[!${type}] T`)?.type).toBe(type);
  });

  it('keeps an unrecognised word verbatim and refuses to guess a type', () => {
    // Inventing a hue from an unknown word would be worse than today's loss,
    // and dropping the text is not on the table. `raw` is what survives.
    expect(parseMarker('[!사내공지] 제목')).toEqual({
      type: null,
      raw: '사내공지',
      title: '제목',
      rest: '',
    });
  });

  it('declines a marker that is not at the very start', () => {
    // A `[!x]` mid-sentence is prose. Claiming it would eat the user's text.
    expect(parseMarker('see [!warning] here')).toBeNull();
  });

  it('declines an unclosed marker rather than guessing where it ends', () => {
    expect(parseMarker('[!warning oops')).toBeNull();
  });

  it('consumes at most one space, so a deliberately indented title survives', () => {
    expect(parseMarker('[!tip]  spaced')?.title).toBe(' spaced');
  });
});

describe('formatMarker', () => {
  it('writes the canonical spelling, not the alias it came from', () => {
    expect(formatMarker(parseMarker('[!CAUTION] x')!.type, null)).toBe('[!warning]');
  });

  it('writes an unrecognised word back verbatim', () => {
    expect(formatMarker(null, '사내공지')).toBe('[!사내공지]');
  });

  it.each(CALLOUT_TYPES)('round-trips %s through parse and format', (type) => {
    const parsed = parseMarker(`[!${type}] T`)!;
    expect(formatMarker(parsed.type, parsed.raw)).toBe(`[!${type}]`);
  });
});
