import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { createSession, findSession, revokeSession } from './sessions.ts';
import { findOrCreateUserByIdentity } from './users.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('sessions', () => {
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    userId = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips a token to its user', async () => {
    const token = await createSession(pool.query, userId);

    expect(await findSession(pool.query, token)).toBe(userId);
  });

  it('stores the hash, never the token', async () => {
    // A database leak must not hand over live sessions. This is the assertion
    // that keeps that true through later refactors.
    const token = await createSession(pool.query, userId);

    /* tenancy-ok: asserting no row anywhere holds the raw token. */
    const rows = (await pool.query('SELECT id FROM sessions')) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).not.toContain(token);
    expect(rows[0]!.id).toHaveLength(64);
  });

  it('rejects an unknown token', async () => {
    expect(await findSession(pool.query, 'nope')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const token = await createSession(pool.query, userId);
    /* tenancy-ok: expiring this user's own session to test the predicate. */
    await pool.query('UPDATE sessions SET expires_at = ? WHERE user_id = ?', [1, userId]);

    expect(await findSession(pool.query, token)).toBeNull();
  });

  it('revokes a session', async () => {
    const token = await createSession(pool.query, userId);

    await revokeSession(pool.query, token);

    expect(await findSession(pool.query, token)).toBeNull();
  });
});
