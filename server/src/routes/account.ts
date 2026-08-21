import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { clearedSessionCookie, cookieName, readCookie, SESSION_COOKIE } from '../auth/cookies.ts';
import { findSession } from '../repositories/sessions.ts';
import { deleteUser } from '../repositories/users.ts';

interface EmailRow {
  email: string | null;
}

export function accountRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const sessionName = cookieName(SESSION_COOKIE, deps.secureCookies);

  async function authenticate(cookieHeader: string | undefined): Promise<string | null> {
    const token = readCookie(cookieHeader, sessionName);
    if (token === null) return null;
    return findSession(deps.query, token);
  }

  app.get('/me', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    const rows = (await deps.query(
      'SELECT email FROM identities WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
      [userId],
    )) as EmailRow[];

    return c.json({ userId, email: rows[0]?.email ?? null });
  });

  app.delete('/account', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    // One delete: identities and sessions cascade. D2's tables must cascade
    // too rather than being added to a list here.
    await deleteUser(deps.query, userId);

    c.header('set-cookie', clearedSessionCookie(deps.secureCookies));
    return c.body(null, 204);
  });

  return app;
}
