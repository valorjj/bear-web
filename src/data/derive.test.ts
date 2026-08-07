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

  it('is idempotent when applied to its own output', () => {
    const once = deriveTitle('# Heading\nbody');
    expect(deriveTitle(once)).toBe(once);
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
