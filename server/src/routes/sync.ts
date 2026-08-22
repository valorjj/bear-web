import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import {
  pull,
  push,
  QuotaExceededError,
  sweepTombstones,
  type PushNote,
  type PushTag,
} from '../repositories/sync.ts';

/**
 * The largest push body this service will read, in bytes.
 *
 * Sized so it cannot reject a legitimate push. The account quota is 10 MiB of
 * note TEXT, and a push carrying the whole of it also carries JSON structure
 * — field names, quotes, timestamps, roughly 150 bytes per note — plus
 * whatever escaping the text needs. Three times the quota leaves room for all
 * of that and then some, while still being a bound: without one, a single
 * `POST` of arbitrary size is parsed into memory on a Mac Mini in someone's
 * house, and the quota check that would have rejected it runs only AFTER the
 * parse it was supposed to prevent.
 */
export const MAX_BODY_BYTES = 3 * 10 * 1024 * 1024;

/**
 * Reads the request body, or returns `null` if it exceeds `MAX_BODY_BYTES`.
 *
 * `Content-Length` is the fast path and is deliberately not trusted as the
 * only one: it is absent from a chunked request and can simply be wrong, so
 * the stream is counted as it arrives and abandoned the moment it crosses the
 * cap. That is what makes this a cap rather than a request to be polite.
 */
async function readCappedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;

  const stream = request.body;
  if (stream === null) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

/**
 * Shape-checks the push body.
 *
 * Not a validation library: the body has two array fields and the alternative
 * is a dependency plus a schema for a payload this file can describe in
 * fifteen lines. What matters is that a malformed body is a 400 naming the
 * problem rather than a 500 from a `.filter` on a string.
 */
function readBatch(body: unknown): { notes: PushNote[]; tags: PushTag[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { notes, tags } = body as { notes?: unknown; tags?: unknown };
  if (!Array.isArray(notes) || !Array.isArray(tags)) return null;

  for (const note of notes) {
    if (typeof note !== 'object' || note === null) return null;
    const n = note as Partial<PushNote>;
    if (typeof n.id !== 'string' || typeof n.text !== 'string') return null;
    if (typeof n.baseRev !== 'number' || typeof n.updatedAt !== 'number') return null;
    if (typeof n.createdAt !== 'number') return null;
    if (typeof n.pinned !== 'boolean' || typeof n.deleted !== 'boolean') return null;
    // `undefined` (a field omitted entirely) is not `null`: both would pass a
    // `typeof x === 'number' || x === null` check only if `undefined` were
    // also excluded here, and an omitted field reaching `push()` binds
    // `undefined` straight into a mysql2 parameter list, which throws
    // "Bind parameters must not contain undefined" from inside a
    // transaction — a 500, not the 400 this function exists to produce.
    if (n.trashedAt !== null && typeof n.trashedAt !== 'number') return null;
    if (n.archivedAt !== null && typeof n.archivedAt !== 'number') return null;
  }

  for (const tag of tags) {
    if (typeof tag !== 'object' || tag === null) return null;
    const t = tag as Partial<PushTag>;
    if (typeof t.tag !== 'string' || typeof t.baseRev !== 'number') return null;
    if (typeof t.collapsed !== 'boolean' || typeof t.deleted !== 'boolean') return null;
    if (typeof t.sortOrder !== 'number') return null;
    if (t.iconKey !== null && typeof t.iconKey !== 'string') return null;
  }

  return { notes: notes as PushNote[], tags: tags as PushTag[] };
}

export function syncRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.get('/sync', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    // `Number('banana')` is NaN and `NaN > x` is false for every x, which would
    // silently return an empty pull forever. Coerce to a floor of 0 instead.
    const raw = Number(c.req.query('since'));
    const since = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;

    // Opportunistic, and deliberately before the read: a tombstone old enough
    // to sweep is one no live device still needs, so removing it first keeps
    // the response from carrying rows about to be deleted anyway.
    await sweepTombstones(deps.query, userId, Date.now());

    return c.json(await pull(deps.query, userId, since));
  });

  app.post('/sync', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    // Read under a cap BEFORE parsing. `c.req.json()` would buffer and parse
    // whatever arrives, and the quota that bounds an account's stored bytes
    // runs inside `push()`, long after the object graph exists.
    const text = await readCappedBody(c.req.raw);
    if (text === null) {
      return c.json({ error: 'body too large', limit: MAX_BODY_BYTES }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ error: 'body is not JSON' }, 400);
    }

    const batch = readBatch(body);
    if (batch === null) return c.json({ error: 'expected { notes: [], tags: [] }' }, 400);

    try {
      return c.json(await push(deps.transaction, userId, batch));
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return c.json({ error: 'quota', used: error.used, limit: error.limit }, 413);
      }
      throw error;
    }
  });

  return app;
}
