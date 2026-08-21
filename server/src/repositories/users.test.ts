import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../app.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { deleteUser, findOrCreateUserByIdentity, linkIdentity } from './users.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('users', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a user on first sight of an identity', async () => {
    const id = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same user for the same identity', async () => {
    const claims = { provider: 'google', subject: 'sub-1', email: 'a@example.com' };

    const first = await findOrCreateUserByIdentity(pool.transaction, claims);
    const second = await findOrCreateUserByIdentity(pool.transaction, claims);

    expect(second).toBe(first);
  });

  it('does NOT link a different provider that reports the same email', async () => {
    // The security rule, and the one most likely to be "helpfully" broken by a
    // later change. A provider that admits an unverified address would
    // otherwise hand over someone else's notes.
    const google = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
    const github = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });

    expect(github).not.toBe(google);
  });

  it('links a second provider when asked explicitly', async () => {
    const userId = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    await linkIdentity(pool.query, userId, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });

    const reached = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });
    expect(reached).toBe(userId);
  });

  it('refuses to link an identity already owned by another user', async () => {
    const a = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-a',
      email: 'a@example.com',
    });
    await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'github',
      subject: '99',
      email: 'b@example.com',
    });

    await expect(
      linkIdentity(pool.query, a, { provider: 'github', subject: '99', email: null }),
    ).rejects.toThrow(/already linked/);
  });

  it('leaves no orphan user when the identity insert fails', async () => {
    // The two inserts are one unit. Run through the pool they were not, so two
    // concurrent first-time logins for the same subject raced: the second
    // identity insert violated the primary key and the users row it existed to
    // justify survived — an account nobody can ever sign into, and a direct
    // contradiction of the callback's "no user unless identity was proven".
    const failsOnIdentity: Transaction = (run) =>
      pool.transaction((query) =>
        run(async (sql, params) => {
          if (/INSERT\s+INTO\s+identities/i.test(sql)) throw new Error('identity insert failed');
          return query(sql, params);
        }),
      );

    await expect(
      findOrCreateUserByIdentity(failsOnIdentity, {
        provider: 'google',
        subject: 'sub-1',
        email: 'a@example.com',
      }),
    ).rejects.toThrow(/identity insert failed/);

    /* tenancy-ok: asserting no user row anywhere outlived the failed insert. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('deletes the user and cascades the identity', async () => {
    const id = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    await deleteUser(pool.query, id);

    /* tenancy-ok: counting the rows that should no longer exist for this user. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?', [
      id,
    ])) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
