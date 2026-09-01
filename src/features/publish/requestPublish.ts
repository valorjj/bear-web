// Direct path, not the `@/data` barrel: this file is reached only through
// `PublishDialogContainer`'s `React.lazy` boundary (see `NoteEditor.tsx`).
// Importing the barrel pulls its whole Dexie-repository graph into the
// reachability set of that lazy chunk, tipping Rolldown into extracting a
// new shared chunk that lands back in the eager closure — measured cost:
// several hundred bytes of pure split overhead, against 455 B of headroom.
// A per-call dynamic `import()` was tried first and measured WORSE (+12 KB):
// it forces Vite's dynamic-import preload helper to grow from a 368 B shim
// into a full ~12 KB implementation the moment a lazy chunk itself contains
// a further dynamic import, and that helper is needed synchronously by the
// entry regardless. The static leaf import below has no such cost:
// `@/data/sync/config.ts` has no imports of its own, so this also carries no
// risk of the circular dependency the very first version of this file (a
// per-call dynamic import, before that measurement) was written to avoid.
import { API_ORIGIN } from '@/data/sync/config';

/**
 * Why a publish can fail, and only these seven ways.
 *
 * Seven, not one: a user with no connectivity, one who is signed out, one who
 * is over quota, and one whose request was rate limited each need different
 * sentences, and a single "publish failed" tells none of them anything they can
 * act on.
 */
export type PublishFailure =
  | 'offline'
  | 'unauthorized'
  | 'tooLarge'
  | 'quotaExceeded'
  | 'rateLimited'
  | 'unavailable'
  | 'failed';

export class PublishError extends Error {
  readonly reason: PublishFailure;
  readonly limit?: number;

  constructor(reason: PublishFailure, limit?: number) {
    super(`publish failed: ${reason}`);
    this.name = 'PublishError';
    this.reason = reason;
    this.limit = limit;
  }
}

/**
 * A published page record as returned by the server.
 */
export interface PublishedPage {
  id: string;
  noteId: string;
  title: string;
  bytes: number;
  publishedAt: number;
}

/**
 * The server distinguishes "unreachable or shedding load" (503) from "timed
 * out" (504) for its own operators, but hands the USER the same sentence
 * either way — there is no separate `PublishFailure` for a timeout, so both
 * collapse to `unavailable`.
 *
 * 403 is handled specially to extract the limit from the response body.
 * Unmapped status codes fall through to the default 'failed'.
 */
const BY_STATUS: Record<number, PublishFailure> = {
  401: 'unauthorized',
  413: 'tooLarge',
  429: 'rateLimited',
  503: 'unavailable',
  504: 'unavailable',
};

/**
 * Publishes a note by sending its rendered HTML to the server.
 *
 * The title must be URL-encoded via URLSearchParams, not concatenated — titles
 * are frequently Korean and may contain `&`, `#` or `%`, which would corrupt
 * the query string if not properly encoded.
 *
 * A thrown fetch is mapped to `offline` rather than to a generic failure: a
 * user with no connectivity and a user whose server is down need different
 * sentences, and collapsing them tells neither of them anything.
 *
 * A 403 response is always mapped to `quotaExceeded`, and the server's `limit`
 * field is carried out so the message can name it. An unreadable response body
 * must not become an unhandled exception — `quotaExceeded` with no limit is
 * still correct.
 */
export async function publishNote(
  html: string,
  noteId: string,
  title: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<{ id: string; url: string; publishedAt: number }> {
  const { fetch: doFetch = globalThis.fetch } = deps;

  const params = new URLSearchParams();
  params.set('noteId', noteId);
  params.set('title', title);

  let response: Response;
  try {
    response = await doFetch(`${API_ORIGIN}/publish?${params}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'text/html' },
      body: html,
    });
  } catch {
    throw new PublishError('offline');
  }

  if (response.status === 403) {
    let limit: number | undefined;
    try {
      const body = await response.json();
      limit = body.limit;
    } catch {
      // Unreadable body is fine; quotaExceeded is correct either way
    }
    throw new PublishError('quotaExceeded', limit);
  }

  if (!response.ok) throw new PublishError(BY_STATUS[response.status] ?? 'failed');

  return response.json();
}

/**
 * Unpublishes a note by removing its published page.
 *
 * A thrown fetch is mapped to `offline`.
 */
export async function unpublishNote(
  id: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<void> {
  const { fetch: doFetch = globalThis.fetch } = deps;

  let response: Response;
  try {
    response = await doFetch(`${API_ORIGIN}/publish/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    throw new PublishError('offline');
  }

  if (!response.ok) throw new PublishError(BY_STATUS[response.status] ?? 'failed');
}

/**
 * Lists all published pages for the current user.
 */
export async function listPublished(
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<PublishedPage[]> {
  const { fetch: doFetch = globalThis.fetch } = deps;

  let response: Response;
  try {
    response = await doFetch(`${API_ORIGIN}/publish`, {
      credentials: 'include',
    });
  } catch {
    throw new PublishError('offline');
  }

  if (!response.ok) throw new PublishError(BY_STATUS[response.status] ?? 'failed');

  const body = await response.json();
  return body.pages;
}
