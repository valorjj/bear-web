import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { getImage, insertImage, usedImageBytes, type ImageRow } from './images.ts';
import { findOrCreateUserByIdentity } from './users.ts';

const url = process.env.TEST_DATABASE_URL;

function row(overrides: Partial<ImageRow> = {}): ImageRow {
  return {
    id: 'f1',
    noteId: 'n1',
    mime: 'image/webp',
    width: 40,
    height: 20,
    bytes: 100,
    createdAt: 1000,
    ...overrides,
  };
}

describe.skipIf(!url)('images repository', () => {
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
    await pool?.end();
  });

  it('stores and reads back a row', async () => {
    await insertImage(pool.query, alice, row());

    expect(await getImage(pool.query, alice, 'f1')).toMatchObject({
      id: 'f1',
      noteId: 'n1',
      mime: 'image/webp',
      width: 40,
      height: 20,
      bytes: 100,
    });
  });

  it('does not return another account’s image', async () => {
    // The multi-tenancy guard is static analysis over SQL TEXT; it cannot see
    // a code path it does not model. This is the test that can, and it is the
    // difference between a scoping bug and a cross-user leak.
    await insertImage(pool.query, alice, row());

    expect(await getImage(pool.query, bob, 'f1')).toBeNull();
  });

  it('is null for an id nobody stored', async () => {
    expect(await getImage(pool.query, alice, 'nope')).toBeNull();
  });

  it('sums only the owner’s bytes', async () => {
    await insertImage(pool.query, alice, row({ id: 'f1', bytes: 100 }));
    await insertImage(pool.query, bob, row({ id: 'f2', bytes: 900 }));

    expect(await usedImageBytes(pool.query, alice)).toBe(100);
  });

  it('reports zero for an account with no images', async () => {
    // `SUM` over no rows is SQL NULL, not 0. Without the `?? 0` the first
    // upload of every account compares against null.
    expect(await usedImageBytes(pool.query, alice)).toBe(0);
  });

  it('ignores a repeat insert rather than failing, because an id is immutable', async () => {
    await insertImage(pool.query, alice, row({ bytes: 100 }));
    await insertImage(pool.query, alice, row({ bytes: 999 }));

    // The FIRST write wins: a retry after a dropped connection must not
    // rewrite metadata for bytes that were never replaced.
    expect((await getImage(pool.query, alice, 'f1'))?.bytes).toBe(100);
    expect(await usedImageBytes(pool.query, alice)).toBe(100);
  });

  it('removes an account’s images when the account goes', async () => {
    await insertImage(pool.query, alice, row());

    /* tenancy-ok: deleting the account itself, by its own id. */
    await pool.query('DELETE FROM users WHERE id = ?', [alice]);

    expect(await usedImageBytes(pool.query, alice)).toBe(0);
  });
});
