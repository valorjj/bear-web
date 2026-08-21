import { randomUUID } from 'node:crypto';

import type { Query, Transaction } from '../app.ts';

export interface Claims {
  provider: string;
  subject: string;
  email: string | null;
}

interface IdentityRow {
  user_id: string;
}

async function findIdentity(query: Query, claims: Claims): Promise<string | null> {
  const rows = (await query(
    /* tenancy-ok: this lookup IS how the user is identified; it cannot filter by the user it resolves. */
    'SELECT user_id FROM identities WHERE provider = ? AND provider_subject = ?',
    [claims.provider, claims.subject],
  )) as IdentityRow[];

  return rows[0]?.user_id ?? null;
}

/**
 * Resolves an identity to a user, creating both on first sight.
 *
 * **Email is never used to match.** Two identities from different providers
 * reporting the same address are two accounts until the user links them from
 * inside an authenticated session. A provider that admits an unverified address
 * would otherwise be a path to someone else's notes, and "the addresses match"
 * is not proof of the same person.
 *
 * Takes a `Transaction`, not a `Query`, because the two inserts must be one
 * unit. Run through the pool they were not: two concurrent first-time logins
 * for the same subject raced, the second `identities` insert violated the
 * primary key, and the `users` row it was meant to justify survived — an
 * orphan account nobody can ever sign into, contradicting this function's own
 * guarantee that no user exists unless an identity was proven.
 */
export async function findOrCreateUserByIdentity(
  transaction: Transaction,
  claims: Claims,
): Promise<string> {
  return transaction(async (query) => {
    const existing = await findIdentity(query, claims);
    if (existing !== null) return existing;

    const userId = randomUUID();
    const now = Date.now();

    await query('INSERT INTO users (id, created_at) VALUES (?, ?)', [userId, now]);
    /* tenancy-ok: creating the first identity for a user that did not exist a line ago. */
    await query(
      `INSERT INTO identities (provider, provider_subject, email, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [claims.provider, claims.subject, claims.email, userId, now],
    );

    return userId;
  });
}

/** Attaches another provider to an existing account. Callers must be authenticated. */
export async function linkIdentity(query: Query, userId: string, claims: Claims): Promise<void> {
  const owner = await findIdentity(query, claims);
  if (owner !== null && owner !== userId) {
    throw new Error('identity already linked to another account');
  }
  if (owner === userId) return;

  await query(
    `INSERT INTO identities (provider, provider_subject, email, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [claims.provider, claims.subject, claims.email, userId, Date.now()],
  );
}

/**
 * Removes the account.
 *
 * One statement, because `identities` and `sessions` carry
 * `ON DELETE CASCADE`. D2's tables must do the same rather than extending a
 * list of deletes here — a forgotten line in such a list is data that outlives
 * the account that owned it.
 */
export async function deleteUser(query: Query, userId: string): Promise<void> {
  await query('DELETE FROM users WHERE id = ?', [userId]);
}
