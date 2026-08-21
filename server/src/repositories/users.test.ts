import { afterAll, beforeEach, describe, expect, it } from 'vitest';

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
    const id = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same user for the same identity', async () => {
    const claims = { provider: 'google', subject: 'sub-1', email: 'a@example.com' };

    const first = await findOrCreateUserByIdentity(pool.query, claims);
    const second = await findOrCreateUserByIdentity(pool.query, claims);

    expect(second).toBe(first);
  });

  it('does NOT link a different provider that reports the same email', async () => {
    // The security rule, and the one most likely to be "helpfully" broken by a
    // later change. A provider that admits an unverified address would
    // otherwise hand over someone else's notes.
    const google = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
    const github = await findOrCreateUserByIdentity(pool.query, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });

    expect(github).not.toBe(google);
  });

  it('links a second provider when asked explicitly', async () => {
    const userId = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    await linkIdentity(pool.query, userId, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });

    const reached = await findOrCreateUserByIdentity(pool.query, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });
    expect(reached).toBe(userId);
  });

  it('refuses to link an identity already owned by another user', async () => {
    const a = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-a',
      email: 'a@example.com',
    });
    await findOrCreateUserByIdentity(pool.query, {
      provider: 'github',
      subject: '99',
      email: 'b@example.com',
    });

    await expect(
      linkIdentity(pool.query, a, { provider: 'github', subject: '99', email: null }),
    ).rejects.toThrow(/already linked/);
  });

  it('deletes the user and cascades the identity', async () => {
    const id = await findOrCreateUserByIdentity(pool.query, {
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
