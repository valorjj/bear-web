import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { createSession, revokeSession, SESSION_MAX_AGE_SECONDS } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import {
  clearedSessionCookie,
  clearedTxCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  txCookie,
  TX_COOKIE,
} from './cookies.ts';
import { authorizeUrl, exchangeCode } from './google.ts';
import { challengeOf, createState, createVerifier } from './pkce.ts';

interface Transaction {
  state: string;
  verifier: string;
}

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const redirectUri = `${deps.env.apiOrigin}/auth/google/callback`;

  app.get('/auth/google', (c) => {
    const state = createState();
    const verifier = createVerifier();

    // The transaction rides in a cookie rather than server state, so the
    // service holds nothing between the two legs and can restart mid-login.
    const transaction: Transaction = { state, verifier };
    c.header(
      'set-cookie',
      txCookie(Buffer.from(JSON.stringify(transaction)).toString('base64url'), deps.secureCookies),
    );

    return c.redirect(
      authorizeUrl({
        clientId: deps.env.googleClientId,
        redirectUri,
        state,
        challenge: challengeOf(verifier),
      }),
      302,
    );
  });

  app.get('/auth/google/callback', async (c) => {
    const raw = readCookie(c.req.header('cookie'), TX_COOKIE);
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (raw === null || code === undefined || state === undefined) {
      return c.text('invalid login transaction', 400);
    }

    let transaction: Transaction;
    try {
      transaction = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Transaction;
    } catch {
      return c.text('invalid login transaction', 400);
    }

    // Anti-forgery: without this the callback would accept a code obtained in
    // some other browser, which is the entire purpose of `state`.
    if (transaction.state !== state) return c.text('invalid login transaction', 400);

    let claims;
    try {
      claims = await exchangeCode({
        code,
        verifier: transaction.verifier,
        clientId: deps.env.googleClientId,
        clientSecret: deps.env.googleClientSecret,
        redirectUri,
        fetch: deps.fetch,
      });
    } catch {
      // No user is created on a provider failure: a half-made account whose
      // identity was never proven is worse than a retry.
      return c.text('provider rejected the exchange', 502);
    }

    const userId = await findOrCreateUserByIdentity(deps.query, claims);
    const token = await createSession(deps.query, userId);

    c.header('set-cookie', clearedTxCookie(deps.secureCookies), { append: true });
    c.header('set-cookie', sessionCookie(token, SESSION_MAX_AGE_SECONDS, deps.secureCookies), {
      append: true,
    });

    return c.redirect(`${deps.env.appOrigin}/`, 302);
  });

  app.post('/auth/logout', async (c) => {
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    if (token !== null) await revokeSession(deps.query, token);

    c.header('set-cookie', clearedSessionCookie(deps.secureCookies));
    return c.json({ ok: true });
  });

  return app;
}
