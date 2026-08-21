import mysql from 'mysql2/promise';

import type { Query } from '../app.ts';

export interface Pool {
  query: Query;
  end: () => Promise<void>;
}

/**
 * The mysql2 pool, exposed as a single parameterised `query`.
 *
 * Route code never sees the driver: it gets `Query` and nothing else, so a
 * string-concatenated statement has no convenient path into existence and the
 * tenancy guard in `scripts/serverBoundaries.test.ts` has a single grammar to
 * scan for.
 */
export function createPool(databaseUrl: string): Pool {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    namedPlaceholders: false,
    // BIGINT columns come back as JS numbers rather than strings. Every BIGINT
    // here is an epoch-millisecond timestamp, comfortably inside Number's
    // exact-integer range until the year 287396.
    supportBigNumbers: true,
    bigNumberStrings: false,
  });

  const query: Query = async (sql, params = []) => {
    const [rows] = await pool.query(sql, params as unknown[]);
    return Array.isArray(rows) ? (rows as unknown[]) : [];
  };

  return { query, end: () => pool.end() };
}

/**
 * A pool for the integration test database, or `null` when none is
 * configured — the shape a caller can check once rather than re-reading the
 * env var, and the one `describe.skipIf` in `migrate.test.ts` is built on.
 */
export function testPool(): Pool | null {
  const url = process.env.TEST_DATABASE_URL;
  return url ? createPool(url) : null;
}
