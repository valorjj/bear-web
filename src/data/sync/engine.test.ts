import { beforeEach, describe, expect, it } from 'vitest';

import { BearDatabase } from '../db';
import { parseTags } from '../tags';
import type { PullResponse, PushResponse, Transport } from './transport';
import { createEngine, LAST_PULLED_REV_KEY, SYNCED_ACCOUNT_KEY } from './engine';

/** A transport whose two answers the test sets directly. No HTTP, no server. */
function fakeTransport(): Transport & {
  pulls: PullResponse[];
  pushed: Array<{ notes: unknown[]; tags: unknown[] }>;
  nextPull: PullResponse;
  nextPush: PushResponse;
} {
  const state = {
    pulls: [] as PullResponse[],
    pushed: [] as Array<{ notes: unknown[]; tags: unknown[] }>,
    nextPull: { notes: [], tags: [], rev: 0 } as PullResponse,
    nextPush: { accepted: [], conflicts: { notes: [], tags: [] }, rev: 0 } as PushResponse,
    async pull() {
      state.pulls.push(state.nextPull);
      return state.nextPull;
    },
    async push(batch: { notes: unknown[]; tags: unknown[] }) {
      state.pushed.push(batch);
      return state.nextPush;
    },
  };
  return state as unknown as ReturnType<typeof fakeTransport>;
}

const ACCOUNT = 'user-1';

describe('sync engine', () => {
  let db: BearDatabase;
  let transport: ReturnType<typeof fakeTransport>;

  beforeEach(async () => {
    db = new BearDatabase(`test-${crypto.randomUUID()}`);
    await db.open();
    transport = fakeTransport();
  });

  function engine(now = () => 1000, generateId = () => 'generated') {
    return createEngine({ db, transport, parseTags, now, generateId });
  }

  it('writes a pulled note into IndexedDB with a derived title', async () => {
    transport.nextPull = {
      notes: [
        {
          id: 'n1',
          text: '# Remote\nbody',
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: false,
          rev: 3,
        },
      ],
      tags: [],
      rev: 3,
    };

    await engine().syncOnce(ACCOUNT);

    const note = await db.notes.get('n1');
    // deriveTitle stays the only author of `title` — the server does not store
    // it, so a divergence here can only come from this line.
    expect(note?.title).toBe('Remote');
    expect((await db.syncState.get(['note', 'n1']))?.syncedRev).toBe(3);
  });

  it('rebuilds the tag index for a pulled note', async () => {
    transport.nextPull = {
      notes: [
        {
          id: 'n1',
          text: 'about #work today',
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: false,
          rev: 3,
        },
      ],
      tags: [],
      rev: 3,
    };

    await engine().syncOnce(ACCOUNT);

    // noteTags is never synced: the rebuild path stays the single authority,
    // and a pulled note must go through it like any local save.
    expect(await db.noteTags.where('noteId').equals('n1').toArray()).toEqual([
      { noteId: 'n1', tag: 'work' },
    ]);
  });

  it('applies a tombstone by purging the local note', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'x',
      text: 'x',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    transport.nextPull = {
      notes: [
        {
          id: 'n1',
          text: '',
          createdAt: 1,
          updatedAt: 5,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: true,
          rev: 4,
        },
      ],
      tags: [],
      rev: 4,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.notes.get('n1')).toBeUndefined();
    expect(await db.syncState.get(['note', 'n1'])).toBeUndefined();
  });

  it('does not overwrite a locally dirty note with a pulled one', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'mine',
      text: 'mine',
      createdAt: 1,
      updatedAt: 9,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 1,
      dirty: 1,
      deleted: 0,
      markedAt: 9,
    });
    transport.nextPull = {
      notes: [
        {
          id: 'n1',
          text: 'theirs',
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: false,
          rev: 3,
        },
      ],
      tags: [],
      rev: 3,
    };

    await engine().syncOnce(ACCOUNT);

    // The push in the same run carries this note with baseRev 1; the server
    // decides. Clobbering it here would destroy the local edit before the
    // conflict rule ever ran.
    expect((await db.notes.get('n1'))?.text).toBe('mine');
  });

  it('pushes dirty notes with the revision it last saw', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'a',
      text: 'a',
      createdAt: 1,
      updatedAt: 7,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 4,
      dirty: 1,
      deleted: 0,
      markedAt: 7,
    });

    await engine().syncOnce(ACCOUNT);

    expect(transport.pushed[0]!.notes).toEqual([
      expect.objectContaining({ id: 'n1', text: 'a', baseRev: 4, deleted: false }),
    ]);
  });

  it('pushes a tombstone for a purged note', async () => {
    await db.syncState.put({
      kind: 'note',
      key: 'gone',
      syncedRev: 4,
      dirty: 1,
      deleted: 1,
      markedAt: 8,
    });

    await engine().syncOnce(ACCOUNT);

    expect(transport.pushed[0]!.notes).toEqual([
      expect.objectContaining({ id: 'gone', deleted: true, baseRev: 4 }),
    ]);
  });

  it('clears dirty on accept when the note has not changed since the push', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'a',
      text: 'a',
      createdAt: 1,
      updatedAt: 7,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 4,
      dirty: 1,
      deleted: 0,
      markedAt: 7,
    });
    transport.nextPush = {
      accepted: [{ id: 'n1', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.syncState.get(['note', 'n1'])).toMatchObject({ dirty: 0, syncedRev: 9 });
  });

  it('LEAVES dirty set when the note changed while the push was in flight', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'a',
      text: 'a',
      createdAt: 1,
      updatedAt: 7,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 4,
      dirty: 1,
      deleted: 0,
      markedAt: 7,
    });
    transport.nextPush = {
      accepted: [{ id: 'n1', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };
    // The edit that lands mid-flight: updatedAt moves past the snapshot.
    await db.notes.update('n1', { text: 'a2', updatedAt: 8 });

    await engine().syncOnce(ACCOUNT);

    // Clearing here would strand 'a2' on this device forever — the note looks
    // saved and synced and the server never hears about it again.
    expect((await db.syncState.get(['note', 'n1']))?.dirty).toBe(1);
  });

  it('keeps the losing text as a (conflict) note and takes the server copy', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'Mine',
      text: '# Mine\nlocal edit',
      createdAt: 1,
      updatedAt: 7,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 4,
      dirty: 1,
      deleted: 0,
      markedAt: 7,
    });
    transport.nextPush = {
      accepted: [],
      conflicts: {
        notes: [
          {
            id: 'n1',
            text: '# Theirs\nremote edit',
            createdAt: 1,
            updatedAt: 8,
            pinned: false,
            trashedAt: null,
            archivedAt: null,
            deleted: false,
            rev: 6,
          },
        ],
        tags: [],
      },
      rev: 6,
    };

    const outcome = await engine().syncOnce(ACCOUNT);

    expect(outcome.conflicts).toBe(1);
    expect((await db.notes.get('n1'))?.text).toBe('# Theirs\nremote edit');

    const copy = await db.notes.get('generated');
    expect(copy?.text).toBe('# Mine\nlocal edit');
    expect(copy?.title).toBe('Mine (conflict)');
    // The copy is a real, pushable note, not a local curiosity.
    expect((await db.syncState.get(['note', 'generated']))?.dirty).toBe(1);
  });

  it('advances the cursor and records the account', async () => {
    transport.nextPull = { notes: [], tags: [], rev: 12 };
    transport.nextPush = { accepted: [], conflicts: { notes: [], tags: [] }, rev: 12 };

    await engine().syncOnce(ACCOUNT);

    expect(await db.settings.get(LAST_PULLED_REV_KEY)).toMatchObject({ value: 12 });
    expect(await db.settings.get(SYNCED_ACCOUNT_KEY)).toMatchObject({ value: ACCOUNT });
  });

  it('resets the cursor when a different account signs in', async () => {
    await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 99 });
    await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: 'someone-else' });
    transport.nextPull = { notes: [], tags: [], rev: 3 };

    await engine().syncOnce(ACCOUNT);

    // Revisions are per-user. Carrying another account's cursor means pulling
    // `rev > 99` from a counter that is at 3 — nothing, forever, silently.
    expect(transport.pulls).toHaveLength(1);
    expect(await db.settings.get(LAST_PULLED_REV_KEY)).toMatchObject({ value: 3 });
  });

  it('syncs tag metadata both ways', async () => {
    await db.tags.add({ tag: 'work', collapsed: true, iconKey: null, sortOrder: 2 });
    await db.syncState.put({
      kind: 'tag',
      key: 'work',
      syncedRev: 0,
      dirty: 1,
      deleted: 0,
      markedAt: 1,
    });
    transport.nextPull = {
      notes: [],
      tags: [
        { tag: 'home', collapsed: false, iconKey: 'house', sortOrder: 1, deleted: false, rev: 2 },
      ],
      rev: 2,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.tags.get('home')).toMatchObject({ iconKey: 'house', sortOrder: 1 });
    expect(transport.pushed[0]!.tags).toEqual([
      expect.objectContaining({ tag: 'work', collapsed: true, sortOrder: 2, baseRev: 0 }),
    ]);
  });
});
