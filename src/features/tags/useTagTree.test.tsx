import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes, tags } from '@/data';

import { useTagTree } from './useTagTree';

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.tags.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTagTree', () => {
  it('starts undefined, not empty', () => {
    const { result } = renderHook(() => useTagTree());
    expect(result.current.nodes).toBeUndefined();
  });

  it('reports the tags of existing notes', async () => {
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());

    await waitFor(() => expect(result.current.nodes).toBeDefined());
    expect(result.current.nodes?.map((n) => n.tag)).toEqual(['work']);
    expect(result.current.nodes?.[0].children.map((c) => c.tag)).toEqual(['work/urgent']);
  });

  it('updates when a note gains a tag', async () => {
    const note = await notes.create('draft');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toEqual([]));

    await notes.save(note.id, 'draft #home');

    await waitFor(() => expect(result.current.nodes?.map((n) => n.tag)).toEqual(['home']));
  });

  it('defaults to expanded and persists a collapse', async () => {
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());

    expect(result.current.isCollapsed('work')).toBe(false);

    await act(async () => {
      result.current.toggle('work');
    });

    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(true));
    await expect(tags.getMeta('work')).resolves.toMatchObject({ collapsed: true });
  });

  it('toggles back to expanded', async () => {
    await notes.create('#work/urgent');
    await tags.setCollapsed('work', true);

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(true));

    await act(async () => {
      result.current.toggle('work');
    });

    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(false));
  });
});

describe('reveal', () => {
  it('expands every collapsed ancestor of a nested tag', async () => {
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());

    await act(async () => {
      result.current.toggle('work');
    });
    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(true));

    await act(async () => {
      result.current.reveal('work/urgent');
    });

    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(false));
  });

  it('leaves the tag itself collapsed — only its ancestors open', async () => {
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());

    await act(async () => {
      result.current.toggle('work');
    });
    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(true));

    // `reveal('work')` has no ancestors of its own — it must not touch
    // `work`'s own disclosure state. Asserting the hook's derived state
    // synchronously right after `act` proves nothing: `setCollapsed` is an
    // async write, and the round trip that would flip `isCollapsed('work')`
    // to `false` (if `reveal` wrongly touched the tag itself, not just its
    // ancestors) has not had a chance to land yet either way — `result
    // .current` reads identically whether `reveal` behaved or not. Spying on
    // `tags.setCollapsed` instead catches the call itself, regardless of
    // timing: `reveal('work')` must issue zero writes.
    const setCollapsed = vi.spyOn(tags, 'setCollapsed');

    await act(async () => {
      result.current.reveal('work');
    });
    // Give any (wrongly) issued write a full round trip to actually land,
    // so "no write happened" isn't merely "not yet observed".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(setCollapsed).not.toHaveBeenCalled();
    expect(result.current.isCollapsed('work')).toBe(true);
  });

  it('is a no-op for a top-level tag', async () => {
    await notes.create('#home');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());

    // Same reasoning as the test above: asserting only the hook's state
    // immediately after `act` would also pass if `reveal` collapsed `home`
    // and the async write simply hadn't landed yet by the time the
    // assertion ran — proven by injection, see the task report. Spying on
    // the write itself is what makes "did nothing" distinct from "did
    // something, not yet visible".
    const setCollapsed = vi.spyOn(tags, 'setCollapsed');

    await act(async () => {
      result.current.reveal('home');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(setCollapsed).not.toHaveBeenCalled();
    expect(result.current.isCollapsed('home')).toBe(false);
  });

  it('leaves an already-expanded ancestor expanded', async () => {
    // Distinct from the two tests above: this ancestor genuinely EXISTS (a
    // real, rendered node `reveal` could open), it just is not collapsed.
    //
    // This used to assert `setCollapsed` was never CALLED, pinning a
    // `collapsed.has(ancestor)` guard that has been deliberately removed — see
    // `useTagTree.ts`'s comment on `reveal`. That guard read a live-query
    // cache to decide whether to write, so whenever the cache lagged the
    // database `reveal` silently wrote nothing and the row it was asked to
    // reveal never appeared. A write count is the wrong invariant to pin here:
    // the ancestor's resulting STATE is what the caller and the user can
    // observe, and one redundant idempotent `put` is not a defect. So this now
    // asserts the outcome, and asserts it after a full round trip so a wrong
    // value would have landed rather than merely not been observed yet.
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());
    expect(result.current.isCollapsed('work')).toBe(false);

    await act(async () => {
      result.current.reveal('work/urgent');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.isCollapsed('work')).toBe(false);
    // `reveal` must not expand the tag it was pointed AT either, only its
    // ancestors — the same invariant the first test in this block pins from
    // the collapsed side.
    expect(result.current.isCollapsed('work/urgent')).toBe(false);
  });

  it('opens a collapsed ancestor even when the cached collapse state is stale', async () => {
    // The regression test for the removed guard, and the only one that can
    // fail against it. `reveal` is called with a `collapsed` cache that has
    // NOT yet seen the write collapsing `work`: the ancestor really is shut in
    // the database, and the guard's cache says otherwise. The guard version
    // issues zero writes here and `work` stays collapsed forever; the
    // unconditional version opens it.
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());

    // Written straight through the repository, so the hook's live query has
    // had no chance to deliver it and `collapsed` is provably stale. Awaiting
    // the write itself (rather than the hook's view of it) is what makes the
    // staleness deterministic instead of a timing game.
    await tags.setCollapsed('work', true);
    expect(result.current.isCollapsed('work')).toBe(false);

    await act(async () => {
      result.current.reveal('work/urgent');
    });

    await waitFor(() => expect(result.current.isCollapsed('work')).toBe(false));
    const meta = await tags.allMeta();
    expect(meta.find((m) => m.tag === 'work')?.collapsed).toBe(false);
  });
});
