import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { writePage } from '../publish/store.ts';
import { upsertPage } from '../repositories/publish.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';

const url = process.env.TEST_DATABASE_URL;
const APP_ORIGIN = 'http://localhost:5173';
const PUBLISH_ORIGIN = 'https://pub.example.com';

describe.skipIf(!url)('GET /share/:id', () => {
  let pool: Pool;
  let root: string;
  let app: ReturnType<typeof createApp>;
  let alice: string;
  let nextNoteId: number;

  beforeEach(async () => {
    pool ??= createPool(url!);
    root = await mkdtemp(join(tmpdir(), 'bear-share-'));
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
      fetch: async () => new Response(null, { status: 502 }),
      secureCookies: false,
    });

    alice = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'alice',
      email: 'alice@example.com',
    });
    nextNoteId = 0;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await pool?.end();
  });

  async function publish(id: string, html: string): Promise<void> {
    nextNoteId += 1;
    await writePage(root, alice, id, html);
    await upsertPage(pool.query, alice, {
      id,
      noteId: `note-${nextNoteId}`,
      title: 'Note',
      bytes: Buffer.byteLength(html, 'utf8'),
      publishedAt: Date.now(),
    });
  }

  it('returns the stored document', async () => {
    await publish('page1', '<!doctype html><html><body>hi</body></html>');

    const response = await app.request('/share/page1');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hi');
  });

  it('404s an unknown id', async () => {
    const response = await app.request('/share/nosuchpage');
    expect(response.status).toBe(404);
  });

  it('404s a malformed id rather than 500ing', async () => {
    // `readPage` THROWS on an unsafe shape rather than sanitising it, so
    // without a guard ahead of it this would be a 500 — which tells an
    // anonymous caller "that id was malformed" as opposed to "that id does
    // not exist". Both must answer the same 404.
    const response = await app.request('/share/..%2F..%2Fetc%2Fpasswd');
    expect(response.status).toBe(404);
  });

  it('404s a row whose file is missing', async () => {
    // A row can exist without its file: the two are not written atomically.
    nextNoteId += 1;
    await upsertPage(pool.query, alice, {
      id: 'orphan',
      noteId: `note-${nextNoteId}`,
      title: 'Note',
      bytes: 10,
      publishedAt: Date.now(),
    });

    const response = await app.request('/share/orphan');
    expect(response.status).toBe(404);
  });

  it('does not answer on the publish host', async () => {
    // The publish host serves the public surface and nothing else. This is
    // `publishHostOnly`'s existing behaviour, asserted here because this
    // route is new and the guarantee is what keeps it off that host.
    await publish('page2', '<!doctype html><html><body>hi</body></html>');

    const response = await app.request('/share/page2', {
      headers: { host: 'pub.example.com' },
    });

    expect(response.status).toBe(404);
  });

  it('carries the app origin in its CORS header, because the app fetches it', async () => {
    await publish('page3', '<!doctype html><html><body>hi</body></html>');

    const response = await app.request('/share/page3');

    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });

  it('is not renderable as HTML by a browser navigated here directly', async () => {
    // A plain GET, reachable by anyone, on the API host that holds the
    // session cookie and serves `/sync`, `/files`, `/account`, `/publish`.
    // `fetchSharedPage` calls `response.text()` and `parseSharedPage` passes
    // `'text/html'` to `DOMParser` explicitly, so it never looks at this
    // header — but a browser must not render these bytes as markup.
    await publish('page-xss', '<!doctype html><script>alert(1)</script><p>hi</p>');

    const response = await app.request('/share/page-xss');

    expect(response.headers.get('content-type')).not.toMatch(/html/);
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
