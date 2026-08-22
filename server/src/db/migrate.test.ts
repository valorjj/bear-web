import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool, type Pool } from './pool.ts';
import { migrate } from './migrate.ts';

const url = process.env.TEST_DATABASE_URL;

describe('the integration suite is not silently skipped', () => {
  it('has a database URL whenever CI is set', () => {
    // The failure this prevents: CI reports green because every database test
    // skipped. A fault injection that "passed" for this reason cost M9a a
    // wrong diagnosis, so the skip condition itself is asserted. Locally,
    // with CI unset, this test runs no assertion at all — that is the honest
    // description of a CI-only guard, not a defect to paper over.
    if (process.env.CI) expect(url, 'CI must set TEST_DATABASE_URL').toBeTruthy();
  });
});

describe.skipIf(!url)('migrate', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(url!);
    // Derived, not listed: a hardcoded drop list here is exactly the trap
    // scripts/serverBoundaries.test.ts avoids for its own table list. D2's
    // `002_sync.sql` added `notes` and `tag_meta` after this list was
    // written, and a stale list left them behind: `schema_migrations` was
    // dropped while `notes`/`tag_meta` survived, so `migrate()` treated
    // `002_sync.sql` as pending and its `CREATE TABLE notes` hit an existing
    // table mid-migration, leaving `identities`/`sessions` never created for
    // every later test file in the project. Wrapping in FOREIGN_KEY_CHECKS=0
    // means parent/child drop order never matters either, so a future
    // migration's tables are covered the moment they exist.
    const rows = (await pool.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE()`,
    )) as Array<{ name: string }>;

    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of rows) {
      await pool.query(`DROP TABLE IF EXISTS \`${name}\``);
    }
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies every migration once', async () => {
    const first = await migrate(pool.query);
    expect(first).toContain('001_init.sql');

    const second = await migrate(pool.query);
    expect(second, 'a second run must be a no-op').toEqual([]);
  });

  it('creates the three account tables', async () => {
    await migrate(pool.query);

    const rows = (await pool.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE()`,
    )) as Array<{ name: string }>;
    const names = rows.map((row) => row.name.toLowerCase());

    expect(names).toContain('users');
    expect(names).toContain('identities');
    expect(names).toContain('sessions');
  });

  it('cascades identities and sessions when a user is deleted', async () => {
    await migrate(pool.query);
    const now = Date.now();

    await pool.query('INSERT INTO users (id, created_at) VALUES (?, ?)', ['u1', now]);
    await pool.query(
      `INSERT INTO identities (provider, provider_subject, email, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['google', 'sub-1', 'a@example.com', 'u1', now],
    );
    await pool.query(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['a'.repeat(64), 'u1', now, now + 1000, now],
    );

    await pool.query('DELETE FROM users WHERE id = ?', ['u1']);

    /* tenancy-ok: asserting the cascade removed the rows FOR this user. */
    const left = (await pool.query('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [
      'u1',
    ])) as Array<{ n: number }>;

    // The cascade is what makes DELETE /account correct rather than a list of
    // deletes someone must remember to extend in D2.
    expect(Number(left[0]!.n)).toBe(0);
  });
});
