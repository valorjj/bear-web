import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { createSession } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import { QUOTA_BYTES } from '../repositories/sync.ts';
import { MAX_BODY_BYTES } from './sync.ts';

const url = process.env.TEST_DATABASE_URL;
const APP_ORIGIN = 'http://localhost:5173';

const env = {
  appOrigin: APP_ORIGIN,
  apiOrigin: 'http://localhost:8787',
  databaseUrl: url ?? '',
  googleClientId: 'id',
  googleClientSecret: 'secret',
  pdfRendererUrl: 'http://127.0.0.1:8788',
};

describe.skipIf(!url)('/sync', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');

    app = createApp({
      env,
      query: pool.query,
      transaction: pool.transaction,
      fetch: globalThis.fetch,
      secureCookies: false,
    });

    const userId = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'alice',
      email: 'alice@example.com',
    });
    const token = await createSession(pool.query, userId);
    cookie = `${cookieName(SESSION_COOKIE, false)}=${token}`;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    return app.request(path, {
      ...init,
      headers: { origin: APP_ORIGIN, cookie, 'content-type': 'application/json', ...init.headers },
    });
  }

  it('refuses an unauthenticated pull', async () => {
    const response = await app.request('/sync?since=0', { headers: { origin: APP_ORIGIN } });
    expect(response.status).toBe(401);
  });

  it('round-trips a note', async () => {
    const body = JSON.stringify({
      notes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          text: 'hello',
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: false,
          baseRev: 0,
        },
      ],
      tags: [],
    });

    const pushed = await request('/sync', { method: 'POST', body });
    expect(pushed.status).toBe(200);

    const pulled = await request('/sync?since=0');
    const data = (await pulled.json()) as { notes: Array<{ text: string }> };
    expect(data.notes.map((n) => n.text)).toEqual(['hello']);
  });

  it('answers 413 when the push would exceed the quota', async () => {
    const body = JSON.stringify({
      notes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          text: 'x'.repeat(QUOTA_BYTES + 1),
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
          deleted: false,
          baseRev: 0,
        },
      ],
      tags: [],
    });

    const response = await request('/sync', { method: 'POST', body });
    expect(response.status).toBe(413);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'quota' });
  });

  it('rejects an oversized body with 413 without parsing it', async () => {
    // The declared length is the fast path: rejected before a single byte of
    // the body is read, let alone parsed into an object graph.
    const response = await request('/sync', {
      method: 'POST',
      body: '{"notes":[],"tags":[]}',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    });

    expect(response.status).toBe(413);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'body too large' });
  });

  it('does not trust content-length: an oversized stream is cut off too', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.fill(0x20);
    let sent = 0;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Comfortably past the cap, and deliberately with no `content-length`
        // at all — a chunked request that lied would otherwise walk straight
        // past the header check.
        if (sent > MAX_BODY_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    const response = await app.request('/sync', {
      method: 'POST',
      headers: { origin: APP_ORIGIN, cookie, 'content-type': 'application/json' },
      body,
      // Node requires this for a streaming request body.
      duplex: 'half',
    } as RequestInit);

    expect(response.status).toBe(413);
  });

  it('rejects a malformed body with 400 rather than a 500', async () => {
    const response = await request('/sync', { method: 'POST', body: '{"notes":"nope"}' });
    expect(response.status).toBe(400);
  });

  it('treats a missing or non-numeric `since` as 0', async () => {
    const response = await request('/sync?since=banana');
    expect(response.status).toBe(200);
  });

  it('rejects a note with an omitted trashedAt with 400 rather than a 500', async () => {
    const body = JSON.stringify({
      notes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          text: 'hello',
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          // trashedAt omitted entirely: undefined, not null.
          archivedAt: null,
          deleted: false,
          baseRev: 0,
        },
      ],
      tags: [],
    });

    const response = await request('/sync', { method: 'POST', body });
    expect(response.status).toBe(400);
  });

  it('shares a rate-limit bucket for the same session token regardless of surrounding cookie junk', async () => {
    const name = cookieName(SESSION_COOKIE, false);
    const token = cookie.split('=')[1];
    const cookieA = `${name}=${token}; a=1`;
    const cookieB = `${name}=${token}; a=2`;

    // Both cookie strings carry the SAME session token under different
    // surrounding text. If the limiter keyed on the raw `Cookie` header
    // (the bug), each string would land in its own bucket and neither
    // would ever see a 429 no matter how many requests were sent — a fresh
    // bucket is available on every request just by appending junk. Proving
    // they SHARE a bucket: exhaust the limit sending only cookieA, then
    // confirm a request under cookieB's differing junk is throttled too.
    let lastStatus = 200;
    for (let i = 0; i < 121; i += 1) {
      const response = await app.request('/sync?since=0', {
        headers: { origin: APP_ORIGIN, cookie: cookieA },
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);

    const throttled = await app.request('/sync?since=0', {
      headers: { origin: APP_ORIGIN, cookie: cookieB },
    });
    expect(throttled.status).toBe(429);
  });
});
