import { describe, expect, it } from 'vitest';

import { exportFilename } from './filename';

const base = { title: 'Groceries', updatedAt: Date.UTC(2026, 7, 18, 5, 30) };

describe('exportFilename', () => {
  it('uses the note title and the requested extension', () => {
    expect(exportFilename(base, 'md')).toBe('Groceries.md');
    expect(exportFilename(base, 'html')).toBe('Groceries.html');
  });

  it('keeps CJK, spaces and ordinary punctuation', () => {
    expect(exportFilename({ ...base, title: '자산화 디자인 기록' }, 'md')).toBe(
      '자산화 디자인 기록.md',
    );
    expect(exportFilename({ ...base, title: 'CPI (July, 8/12)' }, 'md')).toBe(
      'CPI (July, 8-12).md',
    );
  });

  it('replaces characters no filesystem accepts, rather than dropping them', () => {
    // Dropping would silently join words: `a/b` must not become `ab`.
    expect(exportFilename({ ...base, title: 'a/b\\c:d*e?f"g<h>i|j' }, 'md')).toBe(
      'a-b-c-d-e-f-g-h-i-j.md',
    );
  });

  it('collapses runs of replacement characters so a name never reads as a redaction', () => {
    expect(exportFilename({ ...base, title: 'a///b' }, 'md')).toBe('a-b.md');
  });

  it('strips leading and trailing dots and spaces', () => {
    // A leading dot hides the file on Unix; a trailing dot or space is
    // silently stripped by Windows, which makes two exports collide.
    expect(exportFilename({ ...base, title: '  ..hidden..  ' }, 'md')).toBe('hidden.md');
  });

  it('falls back to the note date when the title yields nothing usable', () => {
    // An untitled note, or one titled entirely in forbidden characters, still
    // has to produce a name a user can find again.
    expect(exportFilename({ ...base, title: '' }, 'md')).toBe('2026-08-18.md');
    expect(exportFilename({ ...base, title: '///' }, 'md')).toBe('2026-08-18.md');
  });

  it('caps the stem so the whole name stays inside the common 255-byte limit', () => {
    const long = 'a'.repeat(400);
    const name = exportFilename({ ...base, title: long }, 'html');
    expect(name.endsWith('.html')).toBe(true);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
  });

  it('caps on BYTES, not characters, so a CJK title cannot exceed the limit', () => {
    // Every Hangul syllable is three bytes in UTF-8, so a 200-character title
    // is 600 bytes — a character-based cap would pass this test suite and still
    // produce a name the filesystem rejects.
    const long = '가'.repeat(200);
    const name = exportFilename({ ...base, title: long }, 'md');
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    // And it must not cut a multi-byte character in half.
    expect(name).not.toContain('�');
  });
});
