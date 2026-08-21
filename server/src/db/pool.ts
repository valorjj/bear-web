import mysql from 'mysql2/promise';

import type { Query, Transaction } from '../app.ts';

export interface Pool {
  query: Query;
  transaction: Transaction;
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

  /**
   * One connection, `BEGIN` … `COMMIT` / `ROLLBACK`, released in a `finally`.
   *
   * The release must happen whatever else did, including a rollback that
   * itself throws: a leaked connection is a pool that stops answering after
   * ten failures, with no error naming the cause.
   */
  const transaction: Transaction = async (run) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      try {
        const scoped: Query = async (sql, params = []) => {
          const [rows] = await connection.query(sql, params as unknown[]);
          return Array.isArray(rows) ? (rows as unknown[]) : [];
        };
        const result = await run(scoped);
        await connection.commit();
        return result;
      } catch (cause) {
        await connection.rollback();
        throw cause;
      }
    } finally {
      connection.release();
    }
  };

  return { query, transaction, end: () => pool.end() };
}
