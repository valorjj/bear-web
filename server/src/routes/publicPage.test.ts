import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const PUBLISH_HOST = { host: 'pub.example.com' };

describe.skipIf(!url)('GET /p/:id', () => {
  let pool: Pool;
  let root: string;
  let app: ReturnType<typeof createApp>;
  let alice: string;
  let nextNoteId: number;

  beforeEach(async () => {
    pool ??= createPool(url!);
    root = await mkdtemp(join(tmpdir(), 'bear-public-page-'));
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
    nextNoteId = 0;

    // The row and its file, seeded directly, since every test in this file
    // reads through the public route rather than through `/publish`.
    await seedPage('abc', '<!doctype html><p>hi</p>');
  });

  afterAll(async () => {
    await pool?.end();
    await rm(root, { recursive: true, force: true });
  });

  async function seedPage(id: string, html: string): Promise<void> {
    nextNoteId += 1;
    await writePage(root, alice, id, html);
    await upsertPage(pool.query, alice, {
      id,
      noteId: `note-${nextNoteId}`,
      title: 'T',
      bytes: Buffer.byteLength(html, 'utf8'),
      publishedAt: Date.now(),
    });
  }

  /** A row without its file — the crash window `readPage`'s doc comment names. */
  async function seedRowWithoutFile(id: string): Promise<void> {
    nextNoteId += 1;
    await upsertPage(pool.query, alice, {
      id,
      noteId: `note-${nextNoteId}`,
      title: 'T',
      bytes: 0,
      publishedAt: Date.now(),
    });
  }

  it('serves a published page to a reader with no session', async () => {
    const response = await app.request('/p/abc', { headers: PUBLISH_HOST });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<!doctype html><p>hi</p>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('carries the controls that make author HTML safe to serve', async () => {
    const response = await app.request('/p/abc', { headers: PUBLISH_HOST });

    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:",
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('serves a document containing a script, neutralised rather than stripped', async () => {
    // Notes preserve raw HTML deliberately. The CSP is what makes that safe on
    // a foreign origin; the bytes are the author's and are served verbatim.
    await seedPage('withScript', '<!doctype html><script>alert(1)</script><p>hi</p>');
    const response = await app.request('/p/withScript', { headers: PUBLISH_HOST });

    expect(await response.text()).toContain('<script>');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('404s an unknown id', async () => {
    expect((await app.request('/p/nope', { headers: PUBLISH_HOST })).status).toBe(404);
  });

  it('404s a row whose file is missing', async () => {
    await seedRowWithoutFile('rowOnly');
    // The two are not written atomically; a crash between them leaves this.
    expect((await app.request('/p/rowOnly', { headers: PUBLISH_HOST })).status).toBe(404);
  });

  it('404s a bad id shape without touching the filesystem', async () => {
    expect((await app.request('/p/..', { headers: PUBLISH_HOST })).status).toBe(404);
  });

  it('404s a row whose id has an unsafe shape, never a 500 that would leak why', async () => {
    // A row can never legitimately carry an unsafe-shaped id — ids are
    // randomBytes(16).toString('base64url') — but the guard exists for the
    // case where one somehow does anyway: `readPage`'s own `assertSafe`
    // throws on a shape like this, and an uncaught throw here would surface
    // as a 500, which is exactly the leak the guard exists to prevent (a
    // public reader learning "malformed" instead of "missing"). Hono's own
    // router already blocks `..`/`.` path segments before any handler runs
    // (verified independently against this exact route), so `/p/..` above
    // can never reach this guard at all — this input can, since it is a
    // single path segment Hono passes straight through as `c.req.param('id')`.
    const unsafeId = 'a.b';
    await mkdir(join(root, alice), { recursive: true });
    // Bypasses `writePage`'s own `assertSafe` deliberately, to put a file on
    // disk at the path an unsafe id would resolve to — so a guard-free
    // `readPage` would find bytes rather than 404ing on a missing file, and
    // the only thing left to fail is `assertSafe` itself.
    await writeFile(join(root, alice, `${unsafeId}.html`), '<!doctype html><p>hi</p>', 'utf8');
    nextNoteId += 1;
    await upsertPage(pool.query, alice, {
      id: unsafeId,
      noteId: `note-${nextNoteId}`,
      title: 'T',
      bytes: 10,
      publishedAt: Date.now(),
    });

    const response = await app.request(`/p/${unsafeId}`, { headers: PUBLISH_HOST });
    expect(response.status).toBe(404);
  });

  it('sets an ETag that changes when the page is republished', async () => {
    const first = (await app.request('/p/abc', { headers: PUBLISH_HOST })).headers.get('etag');
    await seedPage('abc', '<!doctype html><p>changed</p>');
    const second = (await app.request('/p/abc', { headers: PUBLISH_HOST })).headers.get('etag');

    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('answers a matching If-None-Match with 304', async () => {
    const etag = (await app.request('/p/abc', { headers: PUBLISH_HOST })).headers.get('etag')!;
    const response = await app.request('/p/abc', {
      headers: { ...PUBLISH_HOST, 'if-none-match': etag },
    });

    expect(response.status).toBe(304);
  });

  it('answers a WEAK If-None-Match echo with 304', async () => {
    // Cloudflare rewrites a strong ETag to weak when it compresses a
    // response, and every published page goes through the tunnel — so a
    // real reader's echo is `W/"<etag>"`, not the strong tag this route
    // sent. RFC 7232's weak comparison (used for If-None-Match) means the
    // prefix is stripped before comparing, not treated as a mismatch.
    const etag = (await app.request('/p/abc', { headers: PUBLISH_HOST })).headers.get('etag')!;
    const response = await app.request('/p/abc', {
      headers: { ...PUBLISH_HOST, 'if-none-match': `W/${etag}` },
    });

    expect(response.status).toBe(304);
  });

  it('answers If-None-Match: * with 304 unconditionally', async () => {
    const response = await app.request('/p/abc', {
      headers: { ...PUBLISH_HOST, 'if-none-match': '*' },
    });

    expect(response.status).toBe(304);
  });

  it('answers a comma-separated If-None-Match list containing the tag with 304', async () => {
    const etag = (await app.request('/p/abc', { headers: PUBLISH_HOST })).headers.get('etag')!;
    const response = await app.request('/p/abc', {
      headers: { ...PUBLISH_HOST, 'if-none-match': `"other", ${etag}` },
    });

    expect(response.status).toBe(304);
  });

  it('sets no CORS or cookie headers', async () => {
    const response = await app.request('/p/abc', { headers: PUBLISH_HOST });

    // Nothing about this response is credentialed. An access-control header here
    // would be the app's origin leaking onto the anonymous host.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
