import { Hono, type Context } from 'hono';

import type { AppDeps } from '../app.ts';
import { createSession, revokeSession, SESSION_MAX_AGE_SECONDS } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import {
  clearedSessionCookie,
  clearedTxCookie,
  cookieName,
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

/** True only when both fields decoded to non-empty strings. A partially- or
 * wrongly-shaped transaction (e.g. an attacker-crafted cookie with a `state`
 * but no `verifier`) must never reach the state comparison or the exchange. */
function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.state === 'string' &&
    candidate.state.length > 0 &&
    typeof candidate.verifier === 'string' &&
    candidate.verifier.length > 0
  );
}

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const redirectUri = `${deps.env.apiOrigin}/auth/google/callback`;
  const txName = cookieName(TX_COOKIE, deps.secureCookies);
  const sessionName = cookieName(SESSION_COOKIE, deps.secureCookies);

  /**
   * Every terminal failure of the callback clears the transaction cookie so
   * the browser stops offering it, but clearing is client-side only: the
   * transaction itself is deliberately stateless (see the comment above the
   * route) and never marked consumed server-side, so an attacker who
   * retained a copy of the cookie value can still replay it within its 600s
   * lifetime and mint a second session for the identity it resolves to.
   * Single-use enforcement today comes entirely from the provider rejecting
   * reuse of the authorization code. That is a real dependency, not a
   * defence-in-depth backstop: if a future provider ever allowed code reuse,
   * closing this would require a server-side consumed-transaction store,
   * which is the statelessness this design deliberately avoids. The impact
   * is bounded — an attacker mints extra sessions for their own identity
   * from one code, not a privilege boundary — and the login-CSRF vector that
   * would have made it matter is closed by the __Host- prefix.
   */
  function invalidTransaction(c: Context, message: string, status: 400 | 502) {
    c.header('set-cookie', clearedTxCookie(deps.secureCookies));
    return c.text(message, status);
  }

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
    const raw = readCookie(c.req.header('cookie'), txName);
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (raw === null || code === undefined || state === undefined) {
      return invalidTransaction(c, 'invalid login transaction', 400);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      return invalidTransaction(c, 'invalid login transaction', 400);
    }

    // Guards against a crafted or partially-formed cookie — e.g. the JSON
    // literal `null`, or an object missing `verifier` — reaching either the
    // state comparison or the token exchange below.
    if (!isTransaction(decoded)) {
      return invalidTransaction(c, 'invalid login transaction', 400);
    }
    const transaction = decoded;

    // Anti-forgery: without this the callback would accept a code obtained in
    // some other browser, which is the entire purpose of `state`.
    if (transaction.state !== state) {
      return invalidTransaction(c, 'invalid login transaction', 400);
    }

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
      return invalidTransaction(c, 'provider rejected the exchange', 502);
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
    const token = readCookie(c.req.header('cookie'), sessionName);
    if (token !== null) await revokeSession(deps.query, token);

    c.header('set-cookie', clearedSessionCookie(deps.secureCookies));
    return c.json({ ok: true });
  });

  return app;
}
