import { describe, expect, it } from 'vitest';

import type { Note } from '@/data';
import { normalizeMarkdown } from '@/features/editor';

import { isSameLocalDay, SMART_LIST_PREDICATES, UNCHECKED_TASK } from './smartLists';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: '',
    text: '',
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const ctx = (overrides: Partial<{ tagged: Set<string>; now: number }> = {}) => ({
  tagged: new Set<string>(),
  now: Date.UTC(2026, 7, 11, 12, 0, 0),
  ...overrides,
});

describe('untagged', () => {
  const untagged = SMART_LIST_PREDICATES.untagged;

  it('accepts a note absent from the tag index', () => {
    expect(untagged(note({ id: 'n1' }), ctx())).toBe(true);
  });

  it('rejects a note present in the tag index', () => {
    expect(untagged(note({ id: 'n1' }), ctx({ tagged: new Set(['n1']) }))).toBe(false);
  });

  it('reads the index rather than the note text', () => {
    // The note's text says `#work`, but the index is the authority: feature
    // code must not acquire a second tag parser, and `noteTags` reflects
    // active notes only, consistently across trash, restore and rebuild.
    expect(untagged(note({ id: 'n1', text: 'see #work' }), ctx())).toBe(true);
  });
});

describe('todo', () => {
  const todo = SMART_LIST_PREDICATES.todo;

  // Derived from the real serializer, NOT hand-written. The parent spec writes
  // the predicate as "contains an unchecked `- [ ]`", which is an assumption
  // about our own output — exactly the kind that ships inert with a green
  // suite. If the serializer's task syntax ever changes, this fixture changes
  // with it and the predicate's own test starts failing.
  const UNCHECKED = normalizeMarkdown('- [ ] buy milk');
  const CHECKED = normalizeMarkdown('- [x] buy milk');

  it('uses a fixture the serializer actually produces', () => {
    expect(UNCHECKED).toContain('[ ]');
    expect(CHECKED).toContain('[x]');
  });

  it('accepts a note with an unchecked task', () => {
    expect(todo(note({ text: UNCHECKED }), ctx())).toBe(true);
  });

  it('rejects a note whose tasks are all checked', () => {
    expect(todo(note({ text: CHECKED }), ctx())).toBe(false);
  });

  it('accepts a note with one unchecked task among checked ones', () => {
    expect(todo(note({ text: `${CHECKED}\n${UNCHECKED}` }), ctx())).toBe(true);
  });

  it('accepts a nested unchecked task', () => {
    expect(todo(note({ text: normalizeMarkdown('- [ ] a\n  - [ ] b') }), ctx())).toBe(true);
  });

  it('accepts non-canonical bullets from an imported note', () => {
    // `importDatabase` accepts arbitrary Markdown, and a note only becomes
    // canonical once it has been through the editor. A checkbox the user can
    // see must not be invisible to this list until they happen to open it.
    expect(todo(note({ text: '* [ ] star' }), ctx())).toBe(true);
    expect(todo(note({ text: '+ [ ] plus' }), ctx())).toBe(true);
  });

  it('rejects a checked task written with a capital X', () => {
    expect(todo(note({ text: '- [X] done' }), ctx())).toBe(false);
  });

  it('rejects prose that merely mentions brackets', () => {
    expect(todo(note({ text: 'the array is [ ] empty' }), ctx())).toBe(false);
    expect(todo(note({ text: 'a - [ ] mid-line' }), ctx())).toBe(false);
  });

  it('rejects an empty note', () => {
    expect(todo(note(), ctx())).toBe(false);
  });
});

describe('today', () => {
  const today = SMART_LIST_PREDICATES.today;
  const noon = new Date(2026, 7, 11, 12, 0, 0).getTime();

  it('accepts a note updated on the same local date', () => {
    const morning = new Date(2026, 7, 11, 0, 30, 0).getTime();
    expect(today(note({ updatedAt: morning }), ctx({ now: noon }))).toBe(true);
  });

  it('accepts a note updated just before local midnight tonight', () => {
    const lateTonight = new Date(2026, 7, 11, 23, 59, 59).getTime();
    expect(today(note({ updatedAt: lateTonight }), ctx({ now: noon }))).toBe(true);
  });

  it('rejects a note updated just before local midnight last night', () => {
    // Not a 24-hour window: this is 12.5 hours ago and still not today.
    const lastNight = new Date(2026, 7, 10, 23, 59, 59).getTime();
    expect(today(note({ updatedAt: lastNight }), ctx({ now: noon }))).toBe(false);
  });

  it('rejects a note from tomorrow', () => {
    const tomorrow = new Date(2026, 7, 12, 0, 0, 1).getTime();
    expect(today(note({ updatedAt: tomorrow }), ctx({ now: noon }))).toBe(false);
  });
});

describe('pinned', () => {
  it('reads the note flag', () => {
    expect(SMART_LIST_PREDICATES.pinned(note({ pinned: true }), ctx())).toBe(true);
    expect(SMART_LIST_PREDICATES.pinned(note({ pinned: false }), ctx())).toBe(false);
  });
});

describe('locked', () => {
  it('accepts nothing, permanently', () => {
    expect(SMART_LIST_PREDICATES.locked(note({ pinned: true, text: '- [ ] x' }), ctx())).toBe(
      false,
    );
  });
});

describe('all and trash', () => {
  it('accepts everything for all', () => {
    expect(SMART_LIST_PREDICATES.all(note(), ctx())).toBe(true);
  });

  it('accepts everything for trash, since the scope query already filtered', () => {
    expect(SMART_LIST_PREDICATES.trash(note(), ctx())).toBe(true);
  });
});

describe('isSameLocalDay', () => {
  it('is false across a local midnight one second apart', () => {
    const before = new Date(2026, 7, 10, 23, 59, 59).getTime();
    const after = new Date(2026, 7, 11, 0, 0, 0).getTime();
    expect(isSameLocalDay(before, after)).toBe(false);
  });

  it('is true across a whole local day', () => {
    expect(
      isSameLocalDay(
        new Date(2026, 7, 11, 0, 0, 0).getTime(),
        new Date(2026, 7, 11, 23, 59, 59).getTime(),
      ),
    ).toBe(true);
  });
});

describe('UNCHECKED_TASK', () => {
  it('is not sticky', () => {
    // A `/g` regex carries `lastIndex` between `.test()` calls, so the same
    // input alternates true/false. A module-level regex used per-note would
    // make roughly half the todo notes vanish from the list.
    expect(UNCHECKED_TASK.test('- [ ] a')).toBe(true);
    expect(UNCHECKED_TASK.test('- [ ] a')).toBe(true);
  });
});
