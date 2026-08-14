import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, notes, tags } from '@/data';

import { useTagTree } from './useTagTree';

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.tags.clear()]);
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

    await act(async () => {
      result.current.reveal('work');
    });

    // `reveal('work')` has no ancestors of its own — it must not touch
    // `work`'s own disclosure state.
    expect(result.current.isCollapsed('work')).toBe(true);
  });

  it('is a no-op for a top-level tag', async () => {
    await notes.create('#home');

    const { result } = renderHook(() => useTagTree());
    await waitFor(() => expect(result.current.nodes).toBeDefined());

    await act(async () => {
      result.current.reveal('home');
    });

    expect(result.current.isCollapsed('home')).toBe(false);
  });
});
