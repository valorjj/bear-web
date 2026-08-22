import { beforeEach, describe, expect, it } from 'vitest';

import { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { markAllDirty, markDeleted } from './markDirty';
import { parseTags } from '../tags';
import type { PullResponse, PushResponse, Transport } from './transport';
import { createEngine, LAST_PULLED_REV_KEY, markConflictText, SYNCED_ACCOUNT_KEY } from './engine';

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

describe('markConflictText', () => {
  it('marks the first non-empty line and leaves the rest verbatim', () => {
    expect(markConflictText('\n# Mine\nbody  \ntail')).toBe('\n# Mine (conflict)\nbody  \ntail');
  });

  it('keeps CRLF line endings intact', () => {
    // A trailing `\r` is the line's ENDING, not trailing whitespace: stripping
    // it rewrites the line endings of exactly one line in a CRLF document.
    expect(markConflictText('# Mine\r\nbody\r\n')).toBe('# Mine (conflict)\r\nbody\r\n');
  });

  it('gives a blank note a marked title without discarding its whitespace', () => {
    // A blank note still needs a title a user can pick out of the list, and
    // the marker becomes a new FIRST line rather than replacing anything.
    expect(markConflictText('')).toBe('(conflict)');
    expect(markConflictText('  \n\t')).toBe('(conflict)\n  \n\t');
  });
});

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
    // The marker lives in the TEXT. A title hand-assigned onto the row is a
    // derived cache that `notes.save` re-derives on the user's next edit and
    // `toNote` re-derives on the next device — either way the marker vanishes
    // and the user is left with two identically-titled notes.
    expect(copy?.text).toBe('# Mine (conflict)\nlocal edit');
    expect(copy?.title).toBe('Mine (conflict)');
    expect(deriveTitle(copy!.text)).toBe(copy?.title);
    // The rest of the losing edit is verbatim.
    expect(copy?.text).toContain('local edit');
    // The copy is a real, pushable note, not a local curiosity.
    expect((await db.syncState.get(['note', 'generated']))?.dirty).toBe(1);
  });

  it('keeps the (conflict) marker when the copy round-trips through a pull', async () => {
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

    await engine().syncOnce(ACCOUNT);
    const copy = (await db.notes.get('generated'))!;

    // Now the second device: the copy comes back down as a pulled note, and
    // the engine derives its title from the text the server stored. The server
    // holds no title, so this is the ONLY place the marker can come from.
    transport.nextPull = {
      notes: [
        {
          id: copy.id,
          text: copy.text,
          createdAt: copy.createdAt,
          updatedAt: copy.updatedAt + 1,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: false,
          rev: 7,
        },
      ],
      tags: [],
      rev: 7,
    };
    transport.nextPush = { accepted: [], conflicts: { notes: [], tags: [] }, rev: 7 };
    await db.syncState.update(['note', copy.id], { dirty: 0 });

    await engine().syncOnce(ACCOUNT);

    expect((await db.notes.get(copy.id))?.title).toBe('Mine (conflict)');
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

  it('does not drop a purge that lands while the push is in flight', async () => {
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
    // The purge lands after `collect` ran, so what the server accepted is the
    // EDIT, not the deletion.
    const push = transport.push;
    transport.push = async (batch) => {
      await db.notes.delete('n1');
      await markDeleted(db, 'note', 'n1', 8);
      return push(batch);
    };

    await engine().syncOnce(ACCOUNT);

    // Dropping the row here would leave the note gone locally, alive on the
    // server, and past the cursor: nothing dirty to push a tombstone, nothing
    // in range to pull it back. Permanent divergence with no error anywhere.
    expect(await db.syncState.get(['note', 'n1'])).toMatchObject({ dirty: 1, deleted: 1 });
  });

  it('owes a tombstone when a never-synced note is purged mid-push', async () => {
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
      syncedRev: 0,
      dirty: 1,
      deleted: 0,
      markedAt: 7,
    });
    transport.nextPush = {
      accepted: [{ id: 'n1', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };
    const push = transport.push;
    transport.push = async (batch) => {
      await db.notes.delete('n1');
      // `syncedRev` is still 0, so `markDeleted` drops the row outright.
      await markDeleted(db, 'note', 'n1', 8);
      return push(batch);
    };

    await engine().syncOnce(ACCOUNT);

    // The server was just handed a note the user deleted, and the only thing
    // that could ever ask for it back is a bookkeeping row.
    expect(await db.syncState.get(['note', 'n1'])).toMatchObject({
      dirty: 1,
      deleted: 1,
      syncedRev: 9,
    });
  });

  it('clears dirty for a note that markAllDirty marked', async () => {
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
    // Adoption and import both go through here, at the first sync a new user
    // ever performs. `now` deliberately differs from the note's `updatedAt`.
    await markAllDirty(db, 5000);
    transport.nextPush = {
      accepted: [{ id: 'n1', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };

    await engine().syncOnce(ACCOUNT);

    // Left dirty, the whole library re-pushes on every sync forever.
    expect((await db.syncState.get(['note', 'n1']))?.dirty).toBe(0);
  });

  it('makes NO copy when a conflict differs only in metadata', async () => {
    // Both devices trashed the same note, milliseconds apart. Device B pushes
    // with a stale baseRev and the server conflicts.
    await db.notes.add({
      id: 'n1',
      title: 'Mine',
      text: '# Mine\nbody',
      createdAt: 1,
      updatedAt: 7,
      pinned: false,
      trashedAt: 6,
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
            text: '# Mine\nbody',
            createdAt: 1,
            updatedAt: 8,
            pinned: false,
            trashedAt: 5,
            archivedAt: null,
            deleted: false,
            rev: 6,
          },
        ],
        tags: [],
      },
      rev: 6,
    };

    await engine().syncOnce(ACCOUNT);

    // The copy exists to preserve TEXT the server is about to overwrite. The
    // text is identical, so a copy preserves nothing — and being deliberately
    // visible it would be pushed and pulled everywhere, resurrecting on every
    // device a note the user deleted on both.
    expect(await db.notes.get('generated')).toBeUndefined();
    expect(await db.notes.count()).toBe(1);
    // Metadata resolves by last-write-wins, this project's documented rule.
    expect(await db.notes.get('n1')).toMatchObject({ trashedAt: 5 });
  });

  it('still copies when a conflict has genuinely different text', async () => {
    await db.notes.add({
      id: 'n1',
      title: 'Mine',
      text: '# Mine\nbody',
      createdAt: 1,
      updatedAt: 7,
      pinned: false,
      trashedAt: 6,
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
            text: '# Theirs\nbody',
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

    await engine().syncOnce(ACCOUNT);

    // Narrowing the comparison must not disable copying altogether. The copy
    // is deliberately VISIBLE even though the local row was trashed: a copy
    // the user cannot find in the note list is not a copy at all.
    expect(await db.notes.get('generated')).toMatchObject({
      text: '# Mine (conflict)\nbody',
      trashedAt: null,
      pinned: false,
    });
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

  it('stores the PULL rev as the cursor, never the higher rev the push allocated', async () => {
    await db.notes.add({
      id: 'mine',
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
      key: 'mine',
      syncedRev: 4,
      dirty: 1,
      deleted: 0,
      markedAt: 7,
    });

    // The pull delivered everything up to rev 10. Another device then wrote a
    // note at rev 11 — which this run never saw — and this run's own push
    // allocated 12.
    transport.nextPull = { notes: [], tags: [], rev: 10 };
    transport.nextPush = {
      accepted: [{ id: 'mine', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 12,
    };

    const outcome = await engine().syncOnce(ACCOUNT);

    // A cursor of 12 means the next pull asks `since=12` and rev 11 is never
    // delivered again — the other device's note silently never arrives. Only
    // the pull's rev is a delivery watermark.
    expect(await db.settings.get(LAST_PULLED_REV_KEY)).toMatchObject({ value: 10 });
    expect(outcome.rev).toBe(10);
  });

  it('converges a conflicted tag onto the server copy instead of re-pushing forever', async () => {
    await db.tags.add({ tag: 'work', collapsed: true, iconKey: 'mine', sortOrder: 9 });
    await db.syncState.put({
      kind: 'tag',
      key: 'work',
      syncedRev: 0,
      dirty: 1,
      deleted: 0,
      markedAt: 1,
    });

    // The shape guest adoption produces on a second device: tags are keyed by
    // NAME, so every tag the account already holds conflicts on the first
    // sync. `applyTags` skipped the server's copy (the row was dirty), the
    // row is absent from `accepted`, and the cursor has moved past the
    // server's rev for it — so nothing but this path can ever settle it.
    transport.nextPull = { notes: [], tags: [], rev: 5 };
    transport.nextPush = {
      accepted: [],
      conflicts: {
        notes: [],
        tags: [
          { tag: 'work', collapsed: false, iconKey: 'house', sortOrder: 1, deleted: false, rev: 5 },
        ],
      },
      rev: 5,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.tags.get('work')).toMatchObject({
      collapsed: false,
      iconKey: 'house',
      sortOrder: 1,
    });
    expect(await db.syncState.get(['tag', 'work'])).toMatchObject({ dirty: 0, syncedRev: 5 });
  });

  it('LEAVES a tag dirty when it was edited while the push was in flight', async () => {
    await db.tags.add({ tag: 'work', collapsed: true, iconKey: null, sortOrder: 2 });
    await db.syncState.put({
      kind: 'tag',
      key: 'work',
      syncedRev: 1,
      dirty: 1,
      deleted: 0,
      markedAt: 1,
    });
    transport.nextPush = {
      accepted: [{ id: 'work', kind: 'tag' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };

    const pushing = transport.push.bind(transport);
    // A local tag edit lands between collection and accept. `TagMeta` has no
    // `updatedAt`, so `markedAt` is the only witness that the row changed.
    transport.push = async (batch) => {
      await db.tags.put({ tag: 'work', collapsed: false, iconKey: 'house', sortOrder: 3 });
      await db.syncState.put({
        kind: 'tag',
        key: 'work',
        syncedRev: 1,
        dirty: 1,
        deleted: 0,
        markedAt: 2,
      });
      return pushing(batch);
    };

    await engine().syncOnce(ACCOUNT);

    // Clearing here would strand the later edit on this device forever,
    // looking perfectly saved.
    expect(await db.syncState.get(['tag', 'work'])).toMatchObject({ dirty: 1, syncedRev: 9 });
  });
});
