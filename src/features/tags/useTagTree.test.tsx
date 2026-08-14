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

  it('writes nothing when the ancestor is already expanded', async () => {
    // Distinct from the two tests above: this ancestor genuinely EXISTS (a
    // real, rendered node `reveal` could open), it just is not collapsed —
    // the `collapsed.has(ancestor)` guard on `useTagTree.ts`'s `reveal` is
    // what this pins, not "no ancestors to consider" at all.
    await notes.create('#work/urgent');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());
    expect(result.current.isCollapsed('work')).toBe(false);

    const setCollapsed = vi.spyOn(tags, 'setCollapsed');

    await act(async () => {
      result.current.reveal('work/urgent');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(setCollapsed).not.toHaveBeenCalled();
  });
});
