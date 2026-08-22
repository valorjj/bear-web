import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { findOrCreateUserByIdentity } from './users.ts';
import { nextRev } from './revisions.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('nextRev', () => {
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    userId = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('starts at 1 and increases by one', async () => {
    const first = await pool.transaction((q) => nextRev(q, userId));
    const second = await pool.transaction((q) => nextRev(q, userId));

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it('never issues the same number twice under concurrency', async () => {
    // The whole point of the counter. `FOR UPDATE` is what makes this pass;
    // a plain read-then-write hands the same number to both callers.
    const issued = await Promise.all(
      Array.from({ length: 8 }, () => pool.transaction((q) => nextRev(q, userId))),
    );

    expect(new Set(issued).size).toBe(8);
  });

  it('counts per user, not globally', async () => {
    const other = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-2',
      email: 'b@example.com',
    });

    await pool.transaction((q) => nextRev(q, userId));
    const theirs = await pool.transaction((q) => nextRev(q, other));

    expect(theirs).toBe(1);
  });
});
