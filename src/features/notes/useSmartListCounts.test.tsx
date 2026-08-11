import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, notes } from '@/data';

import { useSmartListCounts } from './useSmartListCounts';

describe('useSmartListCounts', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.noteTags.clear();
  });

  it('is undefined before the query resolves', () => {
    const { result } = renderHook(() => useSmartListCounts());
    expect(result.current).toBeUndefined();
  });

  it('counts every list from one snapshot', async () => {
    await notes.create('plain note');
    await notes.create('tagged #work');
    await notes.create('- [ ] milk');
    const trashed = await notes.create('bye');
    await notes.trash(trashed.id);

    const { result } = renderHook(() => useSmartListCounts());

    await waitFor(() => expect(result.current).toBeDefined());

    const counts = result.current!;
    expect(counts.all).toBe(3);
    expect(counts.trash).toBe(1);
    expect(counts.todo).toBe(1);
    expect(counts.untagged).toBe(2);
    expect(counts.locked).toBe(0);
    // Every note was just created, so all three are "today".
    expect(counts.today).toBe(3);
    expect(counts.pinned).toBe(0);
  });

  it('keeps untagged and tagged summing to all', async () => {
    await notes.create('a #x');
    await notes.create('b');
    await notes.create('c #y');

    const { result } = renderHook(() => useSmartListCounts());
    await waitFor(() => expect(result.current).toBeDefined());

    // The property seven independent queries cannot guarantee.
    expect(result.current!.untagged).toBe(1);
    expect(result.current!.all).toBe(3);
  });

  it('counts pinned notes', async () => {
    const note = await notes.create('pin me');
    await notes.setPinned(note.id, true);

    const { result } = renderHook(() => useSmartListCounts());
    await waitFor(() => expect(result.current?.pinned).toBe(1));
  });
});
