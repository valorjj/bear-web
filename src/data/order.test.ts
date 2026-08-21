import { describe, expect, it } from 'vitest';

import { compareNotes, DEFAULT_NOTE_ORDER, isNoteOrder, type NoteOrder } from './order';
import type { Note } from './types';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Alpha',
    text: 'Alpha',
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** Sorting a copy, because `.sort` mutates and a shared fixture would leak between tests. */
function sorted(notes: Note[], order: NoteOrder): string[] {
  return [...notes].sort(compareNotes(order)).map((n) => n.id);
}

describe('compareNotes', () => {
  const a = makeNote({ id: 'a', title: 'Apple', createdAt: 300, updatedAt: 100 });
  const b = makeNote({ id: 'b', title: 'Cherry', createdAt: 100, updatedAt: 300 });
  const c = makeNote({ id: 'c', title: 'Banana', createdAt: 200, updatedAt: 200 });
  const all = [a, b, c];

  it('orders by updatedAt, newest first', () => {
    expect(sorted(all, { field: 'updated', newestFirst: true })).toEqual(['b', 'c', 'a']);
  });

  it('orders by updatedAt, oldest first', () => {
    expect(sorted(all, { field: 'updated', newestFirst: false })).toEqual(['a', 'c', 'b']);
  });

  it('orders by createdAt independently of updatedAt', () => {
    expect(sorted(all, { field: 'created', newestFirst: true })).toEqual(['a', 'c', 'b']);
  });

  it('orders by title A to Z when newestFirst is false', () => {
    expect(sorted(all, { field: 'title', newestFirst: false })).toEqual(['a', 'c', 'b']);
  });

  it('inverts the title order too, not only the dates', () => {
    expect(sorted(all, { field: 'title', newestFirst: true })).toEqual(['b', 'c', 'a']);
  });

  it('orders Hangul titles by locale, not by codepoint', () => {
    // 하 (U+D558) precedes 한 (U+D55C) by codepoint, but `가` must come first
    // alphabetically. A `<` comparison happens to agree here; the case that
    // matters is that localeCompare is what decides.
    const ga = makeNote({ id: 'ga', title: '가나다' });
    const ha = makeNote({ id: 'ha', title: '하나' });
    const na = makeNote({ id: 'na', title: '나비' });
    expect(sorted([ha, na, ga], { field: 'title', newestFirst: false })).toEqual([
      'ga',
      'na',
      'ha',
    ]);
  });

  it('sorts untitled notes together under the empty title', () => {
    const untitled = makeNote({ id: 'z', title: '' });
    const titled = makeNote({ id: 'y', title: 'Anything' });
    expect(sorted([titled, untitled], { field: 'title', newestFirst: false })).toEqual(['z', 'y']);
  });

  it('breaks a title tie by id so the order is total and stable', () => {
    const first = makeNote({ id: 'a1', title: 'Same' });
    const second = makeNote({ id: 'a2', title: 'Same' });
    expect(sorted([second, first], { field: 'title', newestFirst: false })).toEqual(['a1', 'a2']);
  });
});

describe('isNoteOrder', () => {
  it('accepts the default', () => {
    expect(isNoteOrder(DEFAULT_NOTE_ORDER)).toBe(true);
  });

  it('rejects an unknown field, so a future settings row cannot reach the comparator', () => {
    expect(isNoteOrder({ field: 'size', newestFirst: true })).toBe(false);
  });

  it('rejects a non-boolean direction', () => {
    expect(isNoteOrder({ field: 'title', newestFirst: 'yes' })).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isNoteOrder(null)).toBe(false);
    expect(isNoteOrder('updated')).toBe(false);
  });
});
