import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import { clearedSessionCookie } from '../auth/cookies.ts';
import { removeUserImages } from '../images/store.ts';
import { deleteUser } from '../repositories/users.ts';

interface EmailRow {
  email: string | null;
}

export function accountRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

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
    // The one thing the database cascade cannot reach. A deletion that leaves
    // the pixels on disk is not a deletion — and this is the spec's day-one
    // requirement rather than a nicety.
    await removeUserImages(deps.env.imageRoot, userId);

    c.header('set-cookie', clearedSessionCookie(deps.secureCookies));
    return c.body(null, 204);
  });

  return app;
}
