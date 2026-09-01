import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { readEnv } from '../env.ts';
import { SESSION_COOKIE, TX_COOKIE } from './cookies.ts';

const url = process.env.TEST_DATABASE_URL;

const ENV = {
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:8787',
  DATABASE_URL: url ?? 'mysql://unused',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  PDF_RENDERER_URL: 'http://127.0.0.1:8788',
  PUBLISH_ORIGIN: 'https://pub.example.com',
};

/** An id_token with the claims we want and a signature nobody checks. See google.ts. */
function idToken(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ sub, email })).toString('base64url');
  return `header.${payload}.signature`;
}

function stubFetch(sub = 'sub-1', email = 'a@example.com'): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ id_token: idToken(sub, email) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch;
}

/** Reads one Set-Cookie value by name from a response. */
function setCookie(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`) && !cookie.includes(`${name}=;`));
}

describe.skipIf(!url)('the Google flow', () => {
  let pool: Pool;

  function app(fetchImpl = stubFetch()) {
    return createApp({
      env: readEnv(ENV),
      query: pool.query,
      transaction: pool.transaction,
      fetch: fetchImpl,
      secureCookies: false,
    });
  }

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('redirects to Google with PKCE and sets a transaction cookie', async () => {
    const response = await app().request('/auth/google');

    expect(response.status).toBe(302);

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/auth/google/callback',
    );
    // The verifier must never leave the server.
    expect(location.searchParams.get('code_verifier')).toBeNull();

    expect(setCookie(response, TX_COOKIE)).toBeDefined();
  });

  it('signs the user in and redirects to the app', async () => {
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const response = await app().request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:5173/');

    const session = setCookie(response, SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session).toContain('HttpOnly');
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    // Without this check the callback accepts a code an attacker obtained
    // elsewhere, which is the whole reason `state` exists.
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;

    const response = await app().request('/auth/google/callback?code=abc&state=forged', {
      headers: { cookie: tx },
    });

    expect(response.status).toBe(400);
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('rejects a callback with no transaction cookie at all', async () => {
    const response = await app().request('/auth/google/callback?code=abc&state=whatever');

    expect(response.status).toBe(400);
  });

  it('returns 502 when the provider fails, without creating a user', async () => {
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const failing = (async () => new Response('nope', { status: 500 })) as typeof globalThis.fetch;
    const response = await app(failing).request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(502);

    /* tenancy-ok: asserting no user row was created by anyone. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('returns 400, not 500, for a transaction cookie that decodes to the JSON literal null', async () => {
    // `Buffer.from('null').toString('base64url')` is `bnVsbA`. A naive
    // `transaction.state` read on `null` throws inside the handler, and an
    // uncaught throw from an unauthenticated request is a remote crash, not
    // a rejection.
    const tx = `${TX_COOKIE}=bnVsbA`;

    const response = await app().request('/auth/google/callback?code=abc&state=whatever', {
      headers: { cookie: tx },
    });

    expect(response.status).toBe(400);
  });

  it('rejects a transaction with a state but no verifier, and issues no session', async () => {
    // A crafted cookie with a state that matches the query but no verifier
    // must not reach the token exchange — PKCE contributes nothing if an
    // attacker can supply their own verifier via an injected transaction.
    const forged = Buffer.from(JSON.stringify({ state: 'forged-state' })).toString('base64url');
    const tx = `${TX_COOKIE}=${forged}`;

    const response = await app().request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent('forged-state')}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(400);
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('clears the transaction cookie on a failed callback, so it cannot be replayed', async () => {
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;

    const response = await app().request('/auth/google/callback?code=abc&state=forged', {
      headers: { cookie: tx },
    });

    expect(response.status).toBe(400);
    const cleared = setCookie(response, TX_COOKIE);
    // setCookie() only matches non-clearing Set-Cookie values, so read the
    // header directly to confirm the transaction cookie was cleared.
    const clearing = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${TX_COOKIE}=`) && cookie.includes('Max-Age=0'));
    expect(cleared).toBeUndefined();
    expect(clearing).toBeDefined();
  });

  it('reuses the account on a second sign-in', async () => {
    async function signIn() {
      const start = await app().request('/auth/google');
      const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      return app().request(`/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, {
        headers: { cookie: tx },
      });
    }

    await signIn();
    await signIn();

    /* tenancy-ok: asserting the total account count across all users. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(1);
  });
  it('clears the transaction cookie when the database fails after a valid exchange', async () => {
    // The success path's two database calls sat outside the try/catch guarding
    // the exchange, so a database error escaped as an unhandled throw: a bare
    // 500 with the transaction cookie still set, which the browser then keeps
    // offering. A DB failure is not a client error, but it IS terminal, so it
    // must end like every other terminal failure.
    const failing = createApp({
      env: readEnv(ENV),
      query: pool.query,
      transaction: async () => {
        throw new Error('database is down');
      },
      fetch: stubFetch(),
      secureCookies: false,
    });

    const start = await failing.request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const response = await failing.request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(500);
    expect(
      response.headers.getSetCookie().some((cookie) => cookie.includes(`${TX_COOKIE}=;`)),
    ).toBe(true);
    // And no session was issued.
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('drives the full flow with the production (secureCookies: true) configuration', async () => {
    // Every other case in this file uses secureCookies: false. This is the
    // one test that proves the __Host- prefixed name is actually written
    // AND read back correctly end to end — a write/read name mismatch here
    // would silently break login in production with no error anywhere.
    function secureApp(fetchImpl = stubFetch()) {
      return createApp({
        env: readEnv(ENV),
        query: pool.query,
        transaction: pool.transaction,
        fetch: fetchImpl,
        secureCookies: true,
      });
    }

    const start = await secureApp().request('/auth/google');
    const txSet = start.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-mf_oauth_tx='))!;
    expect(txSet).toBeDefined();
    expect(txSet).toContain('Secure');
    expect(txSet).toContain('Path=/');
    expect(txSet).not.toContain('Domain');

    const tx = txSet.split(';')[0]!;
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const response = await secureApp().request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(302);
    const sessionSet = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-mf_session='))!;
    expect(sessionSet).toBeDefined();
    expect(sessionSet).toContain('Secure');
    expect(sessionSet).toContain('Path=/');
    expect(sessionSet).not.toContain('Domain');
  });
});
