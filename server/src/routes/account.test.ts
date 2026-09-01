import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { readEnv } from '../env.ts';
import { readPage } from '../publish/store.ts';
import { createSession } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';

const url = process.env.TEST_DATABASE_URL;

// secureCookies is false for these tests, so the cookie name is the bare
// SESSION_COOKIE — never hardcode that assumption in account.ts itself.
const cookie = cookieName(SESSION_COOKIE, false);

describe.skipIf(!url)('account routes', () => {
  let pool: Pool;
  let userId: string;
  let token: string;
  let publishRoot: string;

  function app() {
    return createApp({
      env: readEnv({
        APP_ORIGIN: 'http://localhost:5173',
        API_ORIGIN: 'http://localhost:8787',
        DATABASE_URL: url ?? 'mysql://unused',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        PDF_RENDERER_URL: 'http://127.0.0.1:8788',
        PUBLISH_ORIGIN: 'https://pub.example.com',
        PUBLISH_ROOT: publishRoot,
      }),
      query: pool.query,
      transaction: pool.transaction,
      fetch: globalThis.fetch,
      secureCookies: false,
    });
  }

  beforeEach(async () => {
    pool ??= createPool(url!);
    publishRoot = await mkdtemp(join(tmpdir(), 'bear-account-publish-'));
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    userId = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
    token = await createSession(pool.query, userId);
  });

  afterAll(async () => {
    await pool.end();
    await rm(publishRoot, { recursive: true, force: true });
  });

  it('reports who is signed in', async () => {
    const response = await app().request('/me', {
      headers: { cookie: `${cookie}=${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId, email: 'a@example.com' });
  });

  it('returns 401 with no cookie, and does not invent a user', async () => {
    const response = await app().request('/me');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a forged token', async () => {
    const response = await app().request('/me', {
      headers: { cookie: `${cookie}=forged` },
    });

    expect(response.status).toBe(401);
  });

  it('deletes the account and everything cascading from it', async () => {
    const response = await app().request('/account', {
      method: 'DELETE',
      headers: {
        cookie: `${cookie}=${token}`,
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(204);

    /* tenancy-ok: asserting the account and its cascade are gone entirely. */
    const users = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(users[0]!.n)).toBe(0);

    /* tenancy-ok: sessions must not outlive the user they belonged to. */
    const sessions = (await pool.query('SELECT COUNT(*) AS n FROM sessions')) as Array<{
      n: number;
    }>;
    expect(Number(sessions[0]!.n)).toBe(0);
  });

  it('deleting the account removes a published page from disk, not only its row', async () => {
    const instance = app();
    const published = await instance.request(`/publish?noteId=n&title=${encodeURIComponent('T')}`, {
      method: 'POST',
      headers: {
        cookie: `${cookie}=${token}`,
        origin: 'http://localhost:5173',
        'content-type': 'text/html',
      },
      body: '<p>hi</p>',
    });
    expect(published.status).toBe(201);
    const { id } = (await published.json()) as { id: string };
    expect(await readPage(publishRoot, userId, id)).not.toBeNull();

    const response = await instance.request('/account', {
      method: 'DELETE',
      headers: {
        cookie: `${cookie}=${token}`,
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(204);
    // The database cascade removes the row; only this call removes the
    // bytes. A cascade that leaves pages readable on the internet is not a
    // deletion.
    expect(await readPage(publishRoot, userId, id)).toBeNull();
  });

  it('refuses a mutating request from a foreign origin', async () => {
    // Cookie auth means a cross-site page could otherwise trigger this with
    // the user's own credentials attached.
    const response = await app().request('/account', {
      method: 'DELETE',
      headers: {
        cookie: `${cookie}=${token}`,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(403);

    /* tenancy-ok: asserting the rejected request deleted nothing. */
    const users = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(users[0]!.n)).toBe(1);
  });

  it('carries CORS headers even on a rejected request', async () => {
    // The whole reason CORS is registered before originGuard: a browser must
    // see the 403 itself, not an opaque CORS failure that hides it.
    const response = await app().request('/account', {
      method: 'DELETE',
      headers: {
        cookie: `${cookie}=${token}`,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('allows a safe request with no Origin at all', async () => {
    // A top-level GET carries no Origin in some browsers; guarding safe methods
    // would break the app rather than protect it.
    const response = await app().request('/me', {
      headers: { cookie: `${cookie}=${token}` },
    });

    expect(response.status).toBe(200);
  });
});
