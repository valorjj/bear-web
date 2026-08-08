import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, notes } from '@/data';

import { useNotes } from './useNotes';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.files.clear()]);
});

describe('useNotes', () => {
  it('lists active notes, most recently updated first', async () => {
    const older = await notes.create('older');
    const newer = await notes.create('newer');

    const { result } = renderHook(() => useNotes('active'));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items?.map((n) => n.id)).toEqual([newer.id, older.id]);
  });

  it('lists trashed notes in the trashed scope', async () => {
    const kept = await notes.create('kept');
    const gone = await notes.create('gone');
    await notes.trash(gone.id);

    const { result } = renderHook(() => useNotes('trashed'));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items?.[0]?.id).toBe(gone.id);
    expect(result.current.items?.[0]?.id).not.toBe(kept.id);
  });

  it('resolves the selected id to the note itself', async () => {
    const note = await notes.create('hello');
    const { result } = renderHook(() => useNotes('active'));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.select(note.id));

    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));
  });

  it('keeps a note selected immediately after it is created', async () => {
    // The race this guards: the live query still holds the pre-creation list
    // for a tick after `create` resolves. Reconciling against that stale list
    // would clear the selection the instant a new note is made — the note is
    // absent from the list but present in the database.
    const { result } = renderHook(() => useNotes('active'));
    await waitFor(() => expect(result.current.items).toEqual([]));

    const created = await notes.create('');
    act(() => result.current.select(created.id));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.selectedNoteId).toBe(created.id);
  });

  it('clears the selection when the selected note is purged', async () => {
    const note = await notes.create('doomed');
    const { result } = renderHook(() => useNotes('active'));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.select(note.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));

    await notes.purge(note.id);

    await waitFor(() => expect(result.current.selectedNoteId).toBeNull());
    expect(result.current.selectedNote).toBeNull();
  });

  it('clears the selection when the selected note leaves the scope', async () => {
    const note = await notes.create('doomed');
    const { result } = renderHook(() => useNotes('active'));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.select(note.id));
    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));

    await notes.trash(note.id);

    await waitFor(() => expect(result.current.selectedNoteId).toBeNull());
  });

  it('does not clear a selection while the query is still loading', async () => {
    const note = await notes.create('hello');
    const { result } = renderHook(() => useNotes('active'));

    act(() => result.current.select(note.id));
    expect(result.current.selectedNoteId).toBe(note.id);

    await waitFor(() => expect(result.current.selectedNote?.id).toBe(note.id));
  });
});
