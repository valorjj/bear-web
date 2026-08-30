import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import { readImage, writeImage } from '../images/store.ts';
import {
  getImage,
  IMAGE_QUOTA_BYTES,
  insertImage,
  usedImageBytes,
} from '../repositories/images.ts';

/**
 * The largest single image this service accepts, in bytes.
 *
 * K1 downscales to 2048px on the long edge and encodes WebP at q80, which
 * lands a Retina screenshot at a few hundred KB — so this is not a budget, it
 * is a guard against a client that did not downscale. Read BEFORE the body is
 * buffered, for the same reason `/sync` caps its own: the quota that would
 * reject it runs after the bytes are already in memory on a Mac Mini in
 * someone's house.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The one format K1 stores. A second one arriving means a client is wrong. */
const ACCEPTED_MIME = 'image/webp';

/**
 * The only id shape a URL segment may carry. Identical to the client's
 * `storedImagePath` pattern and to the store's own guard — checked here too so
 * a bad id is a 400 rather than a thrown 500 from deeper in.
 */
const ID = /^[A-Za-z0-9_-]+$/;

function positiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function fileRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.put('/files/:id', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    const id = c.req.param('id');
    if (!ID.test(id)) return c.json({ error: 'bad id' }, 400);

    if (c.req.header('content-type') !== ACCEPTED_MIME) {
      return c.json({ error: 'unsupported type', accepted: ACCEPTED_MIME }, 415);
    }

    const noteId = c.req.header('x-note-id');
    const width = positiveInt(c.req.header('x-width'));
    const height = positiveInt(c.req.header('x-height'));
    if (noteId === undefined || width === null || height === null) {
      return c.json({ error: 'missing or invalid metadata headers' }, 400);
    }

    // Already stored: a repeat is a retry after a dropped connection, not a
    // conflict. An id names ONE immutable image, so the first bytes win and
    // this neither rewrites the file nor the row.
    const existing = await getImage(deps.query, userId, id);
    if (existing !== null) return c.json({ ok: true, existing: true });

    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      return c.json({ error: 'too large', limit: MAX_IMAGE_BYTES }, 413);
    }

    const buffer = new Uint8Array(await c.req.arrayBuffer());
    // Checked again after reading: `content-length` is a claim, and a chunked
    // upload does not send one at all.
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return c.json({ error: 'too large', limit: MAX_IMAGE_BYTES }, 413);
    }

    const used = await usedImageBytes(deps.query, userId);
    if (used + buffer.byteLength > IMAGE_QUOTA_BYTES) {
      return c.json(
        { error: 'quota', used: used + buffer.byteLength, limit: IMAGE_QUOTA_BYTES },
        413,
      );
    }

    // FILE first, then the row. A filesystem and a database cannot be written
    // atomically, so one order has to be chosen: a crash between them leaves
    // an unreferenced file, which is invisible and costs disk. The reverse
    // leaves a row promising bytes that do not exist, which every client reads
    // as a permanent 404.
    await writeImage(deps.env.imageRoot, userId, id, buffer);
    await insertImage(deps.query, userId, {
      id,
      noteId,
      mime: ACCEPTED_MIME,
      width,
      height,
      bytes: buffer.byteLength,
      createdAt: Date.now(),
    });

    return c.json({ ok: true });
  });

  /**
   * How much of the image quota this account has used.
   *
   * Registered BEFORE `/files/:id`, and that is required rather than tidy:
   * Hono matches routes in registration order, so with the parameterised route
   * first, `usage` binds to `:id`, fails the `ID` shape check, and this
   * endpoint answers 400 forever.
   *
   * `limit` is returned rather than left for the client to hardcode, so the
   * two cannot drift when the quota changes.
   */
  app.get('/files/usage', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    return c.json({ used: await usedImageBytes(deps.query, userId), limit: IMAGE_QUOTA_BYTES });
  });

  app.get('/files/:id', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    const id = c.req.param('id');
    if (!ID.test(id)) return c.json({ error: 'bad id' }, 400);

    // `getImage` is scoped by `user_id`, so another account's id is simply not
    // found. The SAME 404 for "missing" and "not yours", deliberately:
    // distinguishing them tells an attacker which ids exist.
    const row = await getImage(deps.query, userId, id);
    if (row === null) return c.json({ error: 'not found' }, 404);

    const bytes = await readImage(deps.env.imageRoot, userId, id);
    // A row without its file — the non-atomic write, interrupted. The client's
    // answer to this and to a missing row is the same placeholder, so this is
    // a 404 rather than a 500.
    if (bytes === null) return c.json({ error: 'not found' }, 404);

    return c.body(bytes as unknown as ArrayBuffer, 200, {
      'content-type': row.mime,
      // Safe precisely because an id names one image forever. `private` keeps
      // it out of any shared cache between the browser and here.
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });

  return app;
}
