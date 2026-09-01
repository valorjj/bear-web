import { randomBytes } from 'node:crypto';

import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import { readCappedBody } from '../http/body.ts';
import { removePage, writePage } from '../publish/store.ts';
import {
  countPages,
  deletePage,
  getPageForNote,
  getPageOwner,
  listPages,
  MAX_PUBLISHED_PAGES,
  PUBLISH_QUOTA_BYTES,
  upsertPage,
  usedPublishBytes,
} from '../repositories/publish.ts';

/**
 * The largest standalone document this service will publish, in bytes.
 *
 * The client posts the same rendered document `/export/pdf` accepts, so this
 * mirrors `MAX_EXPORT_BYTES` rather than inventing a separate arithmetic —
 * both bound "one HTML document with its images inlined as `data:` URIs".
 */
export const MAX_PUBLISH_BYTES = 20 * 1024 * 1024;

/**
 * The only id shape a URL segment may carry — identical to the store's own
 * guard, checked here too so a bad id is a 400 rather than a thrown 500 from
 * deeper in.
 */
const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The capability. 128 bits from a CSPRNG, `base64url` so it matches the
 * `^[A-Za-z0-9_-]+$` shape the store's path guard demands — no encoding step
 * between here and a filename.
 *
 * Never derived from the note id, the title or the time: this string is the
 * only thing between the page and the public.
 */
function newPageId(): string {
  return randomBytes(16).toString('base64url');
}

export function publishRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.post('/publish', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    const noteId = c.req.query('noteId');
    const title = c.req.query('title');
    if (!noteId || !title) {
      return c.json({ error: 'missing noteId or title' }, 400);
    }

    // Before anything else touches disk or the database: a cap enforced
    // after the bytes are written bounds nothing.
    const html = await readCappedBody(c.req.raw, MAX_PUBLISH_BYTES);
    if (html === null) return c.json({ error: 'too large', limit: MAX_PUBLISH_BYTES }, 413);

    // Looked up first so a republish of the same note reuses its id (the
    // whole point: a shared URL must survive a typo fix) and is not charged
    // against the quota or the page count a second time.
    const existing = await getPageForNote(deps.query, userId, noteId);

    if (existing === null) {
      const count = await countPages(deps.query, userId);
      if (count >= MAX_PUBLISHED_PAGES) {
        return c.json({ error: 'limit', limit: MAX_PUBLISHED_PAGES }, 403);
      }
    }

    const bytes = Buffer.byteLength(html, 'utf8');
    const used = await usedPublishBytes(deps.query, userId);
    const effectiveUsed = used - (existing?.bytes ?? 0);
    if (effectiveUsed + bytes > PUBLISH_QUOTA_BYTES) {
      return c.json({ error: 'quota', limit: PUBLISH_QUOTA_BYTES }, 403);
    }

    const id = existing?.id ?? newPageId();
    const publishedAt = Date.now();

    // FILE first, then the row: a row without a file 404s and can simply be
    // republished, while a file without a row is unreachable garbage that
    // `removeUserPages` still cleans up. The reverse would leave a row
    // promising bytes that a reader can never see.
    await writePage(deps.env.publishRoot, userId, id, html);
    await upsertPage(deps.query, userId, { id, noteId, title, bytes, publishedAt });

    return c.json({ id, url: `${deps.env.publishOrigin}/p/${id}`, publishedAt }, 201);
  });

  app.get('/publish', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    return c.json({ pages: await listPages(deps.query, userId) });
  });

  app.delete('/publish/:id', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    const id = c.req.param('id');
    if (!ID.test(id)) return c.json({ error: 'bad id' }, 400);

    // Scoped by owner before anything else runs: another account's id must
    // answer the same 404 a nonexistent id would, and must not touch the
    // filesystem or the row at all — a 404 that deleted something would be
    // worse than a 403.
    const owner = await getPageOwner(deps.query, id);
    if (owner === null || owner.userId !== userId) {
      return c.json({ error: 'not found' }, 404);
    }

    await deletePage(deps.query, userId, id);
    await removePage(deps.env.publishRoot, userId, id);

    return c.body(null, 204);
  });

  return app;
}
