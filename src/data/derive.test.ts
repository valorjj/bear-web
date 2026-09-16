import { describe, expect, it } from 'vitest';

import { deriveTitle } from './derive';
import { newId } from './ids';

describe('deriveTitle', () => {
  it('uses the first non-empty line', () => {
    expect(deriveTitle('My note\nsecond line')).toBe('My note');
  });

  it('strips leading heading hashes', () => {
    expect(deriveTitle('# Heading\n\nbody')).toBe('Heading');
    expect(deriveTitle('### Deep heading')).toBe('Deep heading');
  });

  it('skips leading blank lines and whitespace-only lines', () => {
    expect(deriveTitle('\n\n   \n# Real title')).toBe('Real title');
  });

  it('skips a line that is nothing but tags', () => {
    // Creating a note inside a tag scope seeds `\n#a/b` — a deliberately
    // empty title line with the tag below it (`AppShell`'s create handler).
    // `deriveTitle` skipped the blank line and landed on the tag, so the row
    // was titled `#a/b` and the note the user had not named yet looked named.
    expect(deriveTitle('\n#a/b')).toBe('');
    expect(deriveTitle('#work')).toBe('');
    expect(deriveTitle('  #work   #later  ')).toBe('');
  });

  it('keeps a line that carries a tag AND prose', () => {
    // Only a line with NOTHING else is skipped. A tag the user wrote beside
    // real words is part of what the line says, and the title is the line as
    // written — the same rule the note body follows everywhere else.
    expect(deriveTitle('#work Rewrite the seed helper')).toBe('#work Rewrite the seed helper');
    expect(deriveTitle('Groceries #later')).toBe('Groceries #later');
  });

  it('falls through a tag-only line to the next real line', () => {
    expect(deriveTitle('#a/b\nThe actual title')).toBe('The actual title');
  });

  it('does not mistake a heading for a tag-only line', () => {
    // `# work` is a heading (hash, space); `#work` is a tag. One space apart.
    expect(deriveTitle('# work')).toBe('work');
  });

  it('trims surrounding whitespace', () => {
    expect(deriveTitle('   Padded title   \nbody')).toBe('Padded title');
  });

  it('returns an empty string for empty or whitespace-only text', () => {
    expect(deriveTitle('')).toBe('');
    expect(deriveTitle('   \n\n  ')).toBe('');
  });

  it('does not treat a hash without a following space as a heading', () => {
    expect(deriveTitle('#tag is not a heading')).toBe('#tag is not a heading');
  });

  it('leaves inline markup alone', () => {
    expect(deriveTitle('**bold** title')).toBe('**bold** title');
  });

  it('strips exactly one level of heading syntax', () => {
    expect(deriveTitle('# # nested')).toBe('# nested');
  });

  it('is deterministic for the same text', () => {
    const text = '# Heading\nbody';
    expect(deriveTitle(text)).toBe(deriveTitle(text));
  });

  it('leaves a bare hash alone', () => {
    expect(deriveTitle('#')).toBe('#');
  });

  it('does not treat more than six hashes as a heading', () => {
    expect(deriveTitle('####### seven hashes')).toBe('####### seven hashes');
  });

  it('accepts a tab after the hashes', () => {
    expect(deriveTitle('#\ttab after hash')).toBe('tab after hash');
  });
});

describe('newId', () => {
  it('returns a distinct UUID each call', () => {
    const a = newId();
    const b = newId();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
