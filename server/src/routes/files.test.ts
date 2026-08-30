import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { readImage } from '../images/store.ts';
import { IMAGE_QUOTA_BYTES, insertImage } from '../repositories/images.ts';
import { createSession } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import { MAX_IMAGE_BYTES } from './files.ts';

const url = process.env.TEST_DATABASE_URL;
const APP_ORIGIN = 'http://localhost:5173';

/** Not a real WebP — nothing on this path decodes it, only stores and serves it. */
const BYTES = new Uint8Array([1, 2, 3, 4]);

describe.skipIf(!url)('/files', () => {
  let pool: Pool;
  let root: string;
  let app: ReturnType<typeof createApp>;
  let alice: string;
  let aliceCookie: string;
  let bobCookie: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    root = await mkdtemp(join(tmpdir(), 'bear-files-'));
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
        imageRoot: root,
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

  async function upload(
    id: string,
    options: {
      cookie?: string;
      body?: Uint8Array;
      type?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    return app.request(`/files/${id}`, {
      method: 'PUT',
      headers: {
        origin: APP_ORIGIN,
        cookie: options.cookie ?? aliceCookie,
        'content-type': options.type ?? 'image/webp',
        'x-note-id': 'note-1',
        'x-width': '40',
        'x-height': '20',
        ...options.headers,
      },
      body: options.body ?? BYTES,
    });
  }

  async function download(id: string, cookie = aliceCookie): Promise<Response> {
    return app.request(`/files/${id}`, { headers: { origin: APP_ORIGIN, cookie } });
  }

  it('stores an upload and serves it back', async () => {
    expect((await upload('f1')).status).toBe(200);

    const response = await download('f1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it('serves it as immutable, because an id names one image forever', async () => {
    await upload('f1');

    expect((await download('f1')).headers.get('cache-control')).toContain('immutable');
  });

  it('404s another account’s image, and says nothing about whether it exists', async () => {
    // The SAME answer for "missing" and "not yours": distinguishing them tells
    // an attacker which ids exist.
    await upload('f1');

    expect((await download('f1', bobCookie)).status).toBe(404);
    expect((await download('nope', bobCookie)).status).toBe(404);
  });

  it('404s a row whose file is not on disk', async () => {
    // The non-atomic write, interrupted. The client's answer to this and to a
    // missing row is the same placeholder, so it must not be a 500.
    await insertImage(pool.query, alice, {
      id: 'ghost',
      noteId: 'n1',
      mime: 'image/webp',
      width: 1,
      height: 1,
      bytes: 4,
      createdAt: 1,
    });

    expect((await download('ghost')).status).toBe(404);
  });

  it('refuses an upload with no session', async () => {
    const response = await app.request('/files/f1', {
      method: 'PUT',
      headers: { origin: APP_ORIGIN, 'content-type': 'image/webp' },
      body: BYTES,
    });

    expect(response.status).toBe(401);
    expect(await readImage(root, alice, 'f1')).toBeNull();
  });

  it('refuses a download with no session', async () => {
    await upload('f1');

    const response = await app.request('/files/f1', { headers: { origin: APP_ORIGIN } });

    expect(response.status).toBe(401);
  });

  it('refuses a body over the limit, and writes nothing', async () => {
    const response = await upload('big', { body: new Uint8Array(MAX_IMAGE_BYTES + 1) });

    expect(response.status).toBe(413);
    // Not just the status: a refusal that stores the file anyway is not a
    // refusal.
    expect(await readImage(root, alice, 'big')).toBeNull();
  });

  it('reports usage, and counts only this account’s bytes', async () => {
    await upload('f1', { body: new Uint8Array([1, 2, 3, 4, 5]) });
    await upload('f2', { body: new Uint8Array([1, 2, 3]) });
    // Bob's upload must not appear in Alice's total. A `SUM(bytes)` missing
    // its `user_id` predicate is a cross-account leak of exactly the shape
    // `scripts/serverBoundaries.test.ts`'s tenancy guard exists to reject —
    // and it would still return a plausible-looking number.
    await upload('f3', { cookie: bobCookie, body: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) });

    const response = await app.request('/files/usage', {
      headers: { origin: APP_ORIGIN, cookie: aliceCookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ used: 8, limit: IMAGE_QUOTA_BYTES });
  });

  it('does not let the id route swallow /files/usage', async () => {
    // Hono matches in registration order. With `/files/:id` registered first,
    // `usage` binds to `:id` and fails the id-shape check, so this endpoint
    // answers 400 forever — a failure that looks like a client bug.
    const response = await app.request('/files/usage', {
      headers: { origin: APP_ORIGIN, cookie: aliceCookie },
    });

    expect(response.status).not.toBe(400);
  });

  it('refuses usage to a caller who is not signed in', async () => {
    const response = await app.request('/files/usage', { headers: { origin: APP_ORIGIN } });

    expect(response.status).toBe(401);
  });

  it('refuses a type that is not image/webp, and writes nothing', async () => {
    const response = await upload('f1', { type: 'image/png' });

    expect(response.status).toBe(415);
    expect(await readImage(root, alice, 'f1')).toBeNull();
  });

  it('refuses when the account is at quota, and reports used and limit', async () => {
    // Driven by a row claiming the whole quota rather than by uploading 2 GiB.
    await insertImage(pool.query, alice, {
      id: 'huge',
      noteId: 'n1',
      mime: 'image/webp',
      width: 1,
      height: 1,
      bytes: IMAGE_QUOTA_BYTES,
      createdAt: 1,
    });

    const response = await upload('f2');

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'quota', limit: IMAGE_QUOTA_BYTES });
    expect(await readImage(root, alice, 'f2')).toBeNull();
  });

  it('is idempotent, and the first bytes win', async () => {
    // Ids are client-generated and a retry after a dropped connection is the
    // ordinary case, not a conflict. An id names one immutable image.
    await upload('f1', { body: new Uint8Array([1, 1, 1]) });
    const second = await upload('f1', { body: new Uint8Array([2, 2, 2]) });

    expect(second.status).toBe(200);
    expect(new Uint8Array(await (await download('f1')).arrayBuffer())).toEqual(
      new Uint8Array([1, 1, 1]),
    );
  });

  it('deleting the account removes the bytes from disk, not only the rows', async () => {
    // The database cascade cannot reach the filesystem, and a deletion that
    // leaves the pixels behind is not a deletion.
    await upload('f1');
    expect(await readImage(root, alice, 'f1')).not.toBeNull();

    const response = await app.request('/account', {
      method: 'DELETE',
      headers: { origin: APP_ORIGIN, cookie: aliceCookie },
    });

    expect(response.status).toBe(204);
    expect(await readImage(root, alice, 'f1')).toBeNull();
  });

  it.each([
    ['a traversal', '..%2F..%2Fetc%2Fpasswd'],
    ['a dot segment', '..'],
  ])('refuses %s as an id, and writes nothing', async (_what, id) => {
    const response = await upload(id);

    // 400 from the handler's own id check, or 404 because URL normalisation
    // resolved the segment away before routing ever reached the handler.
    // Either is a refusal; what matters is that neither is a 200 and that
    // nothing lands on disk.
    expect([400, 404]).toContain(response.status);
    expect(await readImage(root, alice, 'passwd')).toBeNull();
  });

  it('refuses an upload missing its metadata headers', async () => {
    const response = await upload('f1', { headers: { 'x-width': 'banana' } });

    expect(response.status).toBe(400);
    expect(await readImage(root, alice, 'f1')).toBeNull();
  });
});
