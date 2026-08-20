import { describe, expect, it } from 'vitest';

import { deriveTitle } from '../src/data/derive.ts';
import { CORPUS, FIXED_NOW } from '../e2e/fixtures/corpus.ts';

/**
 * The design corpus (`e2e/fixtures/corpus.ts`) writes `Note.title` out
 * explicitly, because it seeds IndexedDB directly and `title` is a stored
 * derived cache. Reimplementing `deriveTitle` in the fixture would be a second
 * copy of a rule the data layer owns, so instead the fixture states its answer
 * and this asserts it against the real one.
 *
 * Without this, a fixture whose title drifted from its text would produce a
 * screenshot showing a note list that the app itself could never render — a
 * lying reference image, which is worse than no reference image.
 */
describe('the design screenshot corpus', () => {
  it("agrees with deriveTitle on every note's title", () => {
    for (const note of CORPUS.notes) {
      expect(deriveTitle(note.text), `note ${note.id}`).toBe(note.title);
    }
  });

  it('has unique note ids', () => {
    const ids = CORPUS.notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dates every note before the pinned clock, so no note is in the future', () => {
    for (const note of CORPUS.notes) {
      expect(note.createdAt, `note ${note.id} createdAt`).toBeLessThan(FIXED_NOW);
      expect(note.updatedAt, `note ${note.id} updatedAt`).toBeLessThan(FIXED_NOW);
      expect(note.updatedAt, `note ${note.id} edited before created`).toBeGreaterThanOrEqual(
        note.createdAt,
      );
    }
  });

  it('leaves no note both empty and untouched, which the startup sweep would purge', () => {
    // `runStartupSweep` reclaims a note with empty text whose createdAt equals
    // its updatedAt. A seeded note that qualified would vanish from the shots
    // for reasons that look like a note-list bug.
    for (const note of CORPUS.notes) {
      const empty = note.text.trim() === '';
      expect(empty && note.createdAt === note.updatedAt, `note ${note.id}`).toBe(false);
    }
  });

  it('covers the states the shots exist to show', () => {
    expect(CORPUS.notes.some((note) => note.pinned)).toBe(true);
    expect(CORPUS.notes.some((note) => note.trashedAt !== null)).toBe(true);
    expect(CORPUS.notes.some((note) => note.text.includes('- [ ]'))).toBe(true);
    expect(CORPUS.notes.some((note) => note.text.includes('|'))).toBe(true);
    expect(CORPUS.notes.some((note) => note.text.includes('```'))).toBe(true);
    expect(CORPUS.notes.some((note) => /#[a-z]+\//.test(note.text))).toBe(true);
    expect(CORPUS.notes.some((note) => !note.text.includes('#'))).toBe(true);
    // A note whose body is only its title line, so the list renders its
    // "no additional text" placeholder.
    expect(CORPUS.notes.some((note) => note.text.trim() === note.title)).toBe(true);
  });
});
