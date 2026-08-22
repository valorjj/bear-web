import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { findOrCreateUserByIdentity } from './users.ts';
import {
  pull,
  push,
  QuotaExceededError,
  QUOTA_BYTES,
  sweepTombstones,
  TOMBSTONE_RETENTION_MS,
  type PushNote,
} from './sync.ts';

const url = process.env.TEST_DATABASE_URL;

function note(overrides: Partial<PushNote> = {}): PushNote {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    text: 'hello',
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    deleted: false,
    baseRev: 0,
    ...overrides,
  };
}

describe.skipIf(!url)('sync repository', () => {
  let pool: Pool;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    alice = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'alice',
      email: 'alice@example.com',
    });
    bob = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'bob',
      email: 'bob@example.com',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts a first push and returns it on pull', async () => {
    const result = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    expect(result.accepted).toEqual([{ id: note().id, kind: 'note' }]);

    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes).toHaveLength(1);
    expect(pulled.notes[0]!.text).toBe('hello');
    expect(pulled.notes[0]!.rev).toBe(result.rev);
  });

  it('stamps every row in one push with the same revision', async () => {
    const result = await push(pool.transaction, alice, {
      notes: [note(), note({ id: '22222222-2222-4222-8222-222222222222' })],
      tags: [
        { tag: 'work', collapsed: false, iconKey: null, sortOrder: 0, deleted: false, baseRev: 0 },
      ],
    });

    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes.map((n) => n.rev)).toEqual([result.rev, result.rev]);
    expect(pulled.tags.map((t) => t.rev)).toEqual([result.rev]);
  });

  it('returns only what changed since a revision', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ id: '22222222-2222-4222-8222-222222222222' })],
      tags: [],
    });

    const pulled = await pull(pool.query, alice, first.rev);
    expect(pulled.notes.map((n) => n.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('rejects a note whose server revision has moved past baseRev', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ text: 'from device A', baseRev: first.rev })],
      tags: [],
    });

    // Device B still believes the note is at `first.rev`.
    const stale = await push(pool.transaction, alice, {
      notes: [note({ text: 'from device B', baseRev: first.rev })],
      tags: [],
    });

    expect(stale.accepted).toEqual([]);
    expect(stale.conflicts.notes).toHaveLength(1);
    expect(stale.conflicts.notes[0]!.text).toBe('from device A');

    // And the server copy is untouched by the rejected push.
    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes[0]!.text).toBe('from device A');
  });

  it('accepts a repeat push from the device that made the last write', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    const second = await push(pool.transaction, alice, {
      notes: [note({ text: 'edited', baseRev: first.rev })],
      tags: [],
    });

    expect(second.accepted).toHaveLength(1);
    expect(second.conflicts.notes).toEqual([]);
  });

  it('never shows one user another user’s notes', async () => {
    await push(pool.transaction, alice, { notes: [note({ text: 'alice secret' })], tags: [] });

    const pulled = await pull(pool.query, bob, 0);
    expect(pulled.notes).toEqual([]);
  });

  it('keeps a tombstone for a deleted note', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ deleted: true, text: '', baseRev: first.rev })],
      tags: [],
    });

    const pulled = await pull(pool.query, alice, first.rev);
    expect(pulled.notes).toHaveLength(1);
    expect(pulled.notes[0]!.deleted).toBe(true);
    expect(pulled.notes[0]!.text).toBe('');
  });

  it('refuses a push that would exceed the quota, and writes nothing', async () => {
    const big = 'x'.repeat(QUOTA_BYTES + 1);

    await expect(
      push(pool.transaction, alice, { notes: [note({ text: big })], tags: [] }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes).toEqual([]);
  });

  it('measures the quota in UTF-8 bytes, not characters', async () => {
    // Three bytes per character. A character count would let a user store
    // three times the cap in Korean or emoji.
    const text = '가'.repeat(4);
    await push(pool.transaction, alice, { notes: [note({ text })], tags: [] });

    /* tenancy-ok: reading the byte column back for one user in a test. */
    const rows = (await pool.query('SELECT byte_size FROM notes WHERE user_id = ?', [
      alice,
    ])) as Array<{ byte_size: number }>;
    expect(rows[0]!.byte_size).toBe(12);
  });

  it('sweeps tombstones older than the retention window and keeps newer ones', async () => {
    // `deleted_at` is taken from the pushed `updatedAt`, so the fixture's
    // epoch-1000 default would be 56 years old and swept on the first call.
    // Delete at a real timestamp and move the CLOCK, not the row.
    const deletedAt = Date.now();
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ deleted: true, text: '', updatedAt: deletedAt, baseRev: first.rev })],
      tags: [],
    });

    const kept = await sweepTombstones(pool.query, alice, deletedAt);
    expect(kept).toBe(0);
    expect((await pull(pool.query, alice, first.rev)).notes).toHaveLength(1);

    const swept = await sweepTombstones(pool.query, alice, deletedAt + TOMBSTONE_RETENTION_MS + 1);
    expect(swept).toBe(1);
    expect((await pull(pool.query, alice, 0)).notes).toEqual([]);
  });
});
