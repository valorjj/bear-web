import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';

import { ACTIVE_SCOPE, tagScope, TRASHED_SCOPE } from './scope';
import { useNotes } from './useNotes';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.files.clear()]);
});

describe('useNotes', () => {
  it('lists active notes, most recently updated first', async () => {
    const older = await notes.create('older');
    const newer = await notes.create('newer');

    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items?.map((n) => n.id)).toEqual([newer.id, older.id]);
  });

  it('lists trashed notes in the trashed scope', async () => {
    const kept = await notes.create('kept');
    const gone = await notes.create('gone');
    await notes.trash(gone.id);

    const { result } = renderHook(() => useNotes(TRASHED_SCOPE));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items?.[0]?.id).toBe(gone.id);
    expect(result.current.items?.[0]?.id).not.toBe(kept.id);
  });

  it('resolves the selected id to the note itself', async () => {
    const note = await notes.create('hello');
    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.select(note.id));

    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));
  });

  it('keeps a note selected immediately after it is created', async () => {
    // The race this guards: the live query still holds the pre-creation list
    // for a tick after `create` resolves. Reconciling against that stale list
    // would clear the selection the instant a new note is made — the note is
    // absent from the list but present in the database.
    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));
    await waitFor(() => expect(result.current.items).toEqual([]));

    const created = await notes.create('');
    act(() => result.current.select(created.id));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.selectedNoteId).toBe(created.id);
  });

  it('clears the selection when the selected note is purged', async () => {
    const note = await notes.create('doomed');
    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.select(note.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));

    await notes.purge(note.id);

    await waitFor(() => expect(result.current.selectedNoteId).toBeNull());
    expect(result.current.selectedNote).toBeNull();
  });

  it('clears the selection when the selected note leaves the scope', async () => {
    const note = await notes.create('doomed');
    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.select(note.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));

    await notes.trash(note.id);

    await waitFor(() => expect(result.current.selectedNoteId).toBeNull());
  });

  it('does not clear a selection while the query is still loading', async () => {
    const note = await notes.create('hello');
    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));

    act(() => result.current.select(note.id));
    expect(result.current.selectedNoteId).toBe(note.id);

    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));
  });

  it('reports selectedNote as undefined while the probe is unresolved, distinct from null', async () => {
    // The three states are not interchangeable: `undefined` means "the probe
    // for this selection has not resolved yet" (render nothing); `null` means
    // "resolved, and there is no note" (render the empty state). Collapsing
    // the former into the latter is exactly the bug this test guards —
    // `AppShell` would paint one frame of "No note selected" on every switch.
    const first = await notes.create('first');
    const second = await notes.create('second');
    const { result } = renderHook(() => useNotes(ACTIVE_SCOPE));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select(first.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(first.id));

    // Switching the selection re-tags the probe against the new id, and the
    // live query has not had a tick to resolve against it yet: this must be
    // `undefined`, never `null`, in that window.
    act(() => result.current.select(second.id));
    expect(result.current.selectedNote).toBeUndefined();

    await waitFor(() => expect(result.current.selectedNote?.id).toBe(second.id));
  });
});

describe('tag scope reconciliation', () => {
  it('keeps a note selected after its tag is edited away', async () => {
    const created = await notes.create('#work draft');

    const { result } = renderHook(({ scope }) => useNotes(scope), {
      initialProps: { scope: tagScope('work') },
    });

    act(() => result.current.select(created.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(created.id));

    // The user deletes the hashtag. The note leaves the tag index.
    await notes.save(created.id, 'draft');

    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(result.current.selectedNoteId).toBe(created.id);
    expect(result.current.selectedNote?.id).toBe(created.id);
  });

  it('still deselects a note that is trashed while a tag scope is open', async () => {
    const created = await notes.create('#work draft');

    const { result } = renderHook(() => useNotes(tagScope('work')));

    act(() => result.current.select(created.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(created.id));

    await notes.trash(created.id);

    await waitFor(() => expect(result.current.selectedNoteId).toBeNull());
  });

  it('still deselects a note that is purged while a tag scope is open', async () => {
    const created = await notes.create('#work draft');

    const { result } = renderHook(() => useNotes(tagScope('work')));

    act(() => result.current.select(created.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(created.id));

    await notes.purge(created.id);

    await waitFor(() => expect(result.current.selectedNoteId).toBeNull());
  });

  it('does not refetch on a re-render with an equal tag scope', async () => {
    await notes.create('#work draft');

    const listByTag = vi.spyOn(notes, 'listByTag');

    const { result, rerender } = renderHook(({ tag }) => useNotes(tagScope(tag)), {
      initialProps: { tag: 'work' },
    });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const callsAfterFirstLoad = listByTag.mock.calls.length;
    const first = result.current.items;

    rerender({ tag: 'work' });
    rerender({ tag: 'work' });

    // `tagScope` builds a fresh object every render, so without `scopeKey`
    // these re-renders each look like a dependency change and resubscribe.
    // The flush is required: dexie-react-hooks resubscribes in a passive
    // effect, and the resubscription's query resolves through several more
    // microtask/macrotask hops (fake-indexeddb's request events, then the
    // liveQuery emission), so a single microtask tick is not always enough
    // to observe it — drain several rounds of both queues, deterministically,
    // with no wall-clock wait.
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(listByTag.mock.calls.length).toBe(callsAfterFirstLoad);
    expect(result.current.items).toBe(first);

    listByTag.mockRestore();
  });
});
