import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { readPage } from '../publish/store.ts';
import { MAX_PUBLISHED_PAGES, PUBLISH_QUOTA_BYTES, upsertPage } from '../repositories/publish.ts';
import { createSession } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import { MAX_PUBLISH_BYTES } from './publish.ts';

const url = process.env.TEST_DATABASE_URL;
const APP_ORIGIN = 'http://localhost:5173';
const PUBLISH_ORIGIN = 'https://pub.example.com';

describe.skipIf(!url)('/publish', () => {
  let pool: Pool;
  let root: string;
  let app: ReturnType<typeof createApp>;
  let alice: string;
  let aliceCookie: string;
  let bobCookie: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    root = await mkdtemp(join(tmpdir(), 'bear-publish-'));
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');

    app = createApp({
      env: {
        appOrigin: APP_ORIGIN,
        apiOrigin: 'http://localhost:8787',
        databaseUrl: url ?? '',
        googleClientId: 'id',
        googleClientSecret: 'secret',
        pdfRendererUrl: 'http://127.0.0.1:8788',
        imageRoot: join(root, 'images'),
        publishOrigin: PUBLISH_ORIGIN,
        publishRoot: root,
      },
      query: pool.query,
      transaction: pool.transaction,
      fetch: globalThis.fetch,
      secureCookies: false,
    });

    alice = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'alice',
      email: 'alice@example.com',
    });
    const bob = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'bob',
      email: 'bob@example.com',
    });
    const name = cookieName(SESSION_COOKIE, false);
    aliceCookie = `${name}=${await createSession(pool.query, alice)}`;
    bobCookie = `${name}=${await createSession(pool.query, bob)}`;
  });

  afterAll(async () => {
    await pool?.end();
    await rm(root, { recursive: true, force: true });
  });

  async function publish(
    noteId: string,
    body: string,
    options: { cookie?: string } = {},
  ): Promise<Response> {
    return app.request(`/publish?noteId=${noteId}&title=${encodeURIComponent('T')}`, {
      method: 'POST',
      headers: {
        origin: APP_ORIGIN,
        cookie: options.cookie ?? aliceCookie,
        'content-type': 'text/html',
      },
      body,
    });
  }

  it('requires a session', async () => {
    const response = await app.request('/publish?noteId=n&title=T', {
      method: 'POST',
      headers: { 'content-type': 'text/html', origin: APP_ORIGIN },
      body: '<p>hi</p>',
    });

    expect(response.status).toBe(401);
  });

  it('stores the document and returns its url', async () => {
    const response = await publish('n', '<!doctype html><p>hi</p>');

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; url: string; publishedAt: number };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toBe(`${PUBLISH_ORIGIN}/p/${body.id}`);
    expect(await readPage(root, alice, body.id)).toBe('<!doctype html><p>hi</p>');
  });

  it('keeps the same id and url when the same note is republished', async () => {
    const first = (await (await publish('n', '<p>one</p>')).json()) as { id: string };
    const second = (await (await publish('n', '<p>two</p>')).json()) as { id: string };

    // The whole point: a shared URL must survive a typo fix.
    expect(second.id).toBe(first.id);
    expect(await readPage(root, alice, first.id)).toBe('<p>two</p>');
  });

  it('refuses a document over the cap before writing anything', async () => {
    const response = await publish('n', 'x'.repeat(MAX_PUBLISH_BYTES + 1));

    expect(response.status).toBe(413);
    // The assertion is this, not the status: a cap enforced after the bytes
    // are on disk bounds nothing. Nothing was ever written or recorded.
    expect(await readPage(root, alice, 'anything')).toBeNull();
    const list = await app.request('/publish', { headers: { cookie: aliceCookie } });
    expect(((await list.json()) as { pages: unknown[] }).pages).toEqual([]);
  });

  it('refuses past the page limit', async () => {
    for (let index = 0; index < MAX_PUBLISHED_PAGES; index += 1) {
      const response = await publish(`note-${index}`, '<p>x</p>');
      expect(response.status).toBe(201);
    }

    const response = await publish('one-too-many', '<p>x</p>');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ limit: MAX_PUBLISHED_PAGES });
  });

  it('refuses past the byte quota', async () => {
    await upsertPage(pool.query, alice, {
      id: 'existing-page-id-000000',
      noteId: 'other-note',
      title: 'T',
      bytes: PUBLISH_QUOTA_BYTES,
      publishedAt: Date.now(),
    });

    const response = await publish('n', '<p>x</p>');

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ limit: PUBLISH_QUOTA_BYTES });
  });

  it('counts a republish against the quota only once', async () => {
    // Republishing a page must not consume another chunk of quota, or a note
    // edited fifty times exhausts an account.
    await upsertPage(pool.query, alice, {
      id: 'existing-page-id-000000',
      noteId: 'other-note',
      title: 'T',
      bytes: PUBLISH_QUOTA_BYTES - 100,
      publishedAt: Date.now(),
    });

    const first = await publish('n', 'x'.repeat(50));
    expect(first.status).toBe(201);

    const second = await publish('n', 'x'.repeat(60));
    expect(second.status).toBe(201);
  });

  it('lists the account pages, and only its own', async () => {
    await publish('n1', '<p>a</p>');
    await publish('n2', '<p>b</p>', { cookie: bobCookie });

    const response = await app.request('/publish', { headers: { cookie: aliceCookie } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { pages: { noteId: string }[] };
    expect(body.pages.map((page) => page.noteId)).toEqual(['n1']);
  });

  it('unpublishes, removing both the row and the file', async () => {
    const page = (await (await publish('n', '<p>a</p>')).json()) as { id: string };

    const response = await app.request(`/publish/${page.id}`, {
      method: 'DELETE',
      headers: { cookie: aliceCookie, origin: APP_ORIGIN },
    });

    expect(response.status).toBe(204);
    expect(await readPage(root, alice, page.id)).toBeNull();
    const list = await app.request('/publish', { headers: { cookie: aliceCookie } });
    expect(((await list.json()) as { pages: unknown[] }).pages).toEqual([]);
  });

  it('will not unpublish another account page', async () => {
    const page = (await (await publish('n', '<p>a</p>')).json()) as { id: string };

    const response = await app.request(`/publish/${page.id}`, {
      method: 'DELETE',
      headers: { cookie: bobCookie, origin: APP_ORIGIN },
    });

    expect(response.status).toBe(404);
    // Still there: a 404 that actually deleted would be worse than a 403.
    expect(await readPage(root, alice, page.id)).not.toBeNull();
  });

  it('rejects a bad id shape rather than reaching the filesystem', async () => {
    // A bare '..' segment is resolved away by URL normalisation before Hono
    // ever routes the request (verified: it never reaches the handler as a
    // literal param, matching the same normalisation `files.ts`'s tests
    // accommodate), so it 404s for a reason unrelated to the ID check this
    // test exists to exercise. 'bad.id' reaches the handler as a literal
    // segment and still contains a character `pagePath`'s guard would throw
    // on — proving the handler's own check runs before the filesystem does.
    const response = await app.request('/publish/bad.id', {
      method: 'DELETE',
      headers: { cookie: aliceCookie, origin: APP_ORIGIN },
    });

    expect(response.status).toBe(400);
  });

  it('requires noteId and title', async () => {
    for (const query of ['', '?noteId=n', '?title=T']) {
      const response = await app.request(`/publish${query}`, {
        method: 'POST',
        headers: { 'content-type': 'text/html', origin: APP_ORIGIN, cookie: aliceCookie },
        body: '<p>x</p>',
      });
      expect(response.status, query).toBe(400);
    }
  });
});
