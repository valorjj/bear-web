import { createHash, randomBytes } from 'node:crypto';

import type { Query } from '../app.ts';

/** Thirty days, rolling: `last_seen_at` moves on every authenticated request. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The cookie carries the token; the table stores its SHA-256.
 *
 * Not a JWT, deliberately: a session is a row, so logout and suspicion
 * actually revoke. And not the token itself, so a database leak yields hashes
 * rather than live sessions.
 */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(query: Query, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();

  await query(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    [hash(token), userId, now, now + SESSION_MAX_AGE_SECONDS * 1000, now],
  );

  return token;
}

export async function findSession(query: Query, token: string): Promise<string | null> {
  const now = Date.now();

  /* tenancy-ok: this lookup IS how the user is identified; it cannot filter by the user it resolves. */
  const rows = (await query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?', [
    hash(token),
    now,
  ])) as Array<{ user_id: string }>;

  const userId = rows[0]?.user_id ?? null;
  if (userId === null) return null;

  await query('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND user_id = ?', [
    now,
    now + SESSION_MAX_AGE_SECONDS * 1000,
    hash(token),
    userId,
  ]);

  return userId;
}

export async function revokeSession(query: Query, token: string): Promise<void> {
  /* tenancy-ok: the token identifies the row; the caller has no user id yet. */
  await query('DELETE FROM sessions WHERE id = ?', [hash(token)]);
}
