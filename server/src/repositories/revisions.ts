import type { Query } from '../app.ts';

interface CounterRow {
  rev_counter: number;
}

/**
 * Allocates the caller's next revision number.
 *
 * **Must be called inside a `Transaction`.** Two things depend on it: the
 * `SELECT ... FOR UPDATE` only holds its row lock for the life of a
 * transaction, and the spec requires the counter to move in the same
 * transaction as the write it stamps. Called against the pool `Query`, each
 * statement is its own transaction and two concurrent pushes are handed the
 * same number — which silently makes one device's writes invisible to the
 * other's `rev > since` pull, forever.
 *
 * `users` is keyed by `id`, not `user_id`, so the tenancy guard does not
 * derive it as user-scoped and these statements need no annotation.
 */
export async function nextRev(query: Query, userId: string): Promise<number> {
  const rows = (await query('SELECT rev_counter FROM users WHERE id = ? FOR UPDATE', [
    userId,
  ])) as CounterRow[];

  const current = rows[0]?.rev_counter;
  if (current === undefined) throw new Error(`no such user: ${userId}`);

  const next = current + 1;
  await query('UPDATE users SET rev_counter = ? WHERE id = ?', [next, userId]);
  return next;
}
