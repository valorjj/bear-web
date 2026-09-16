import { API_ORIGIN } from '@/data/sync/config';

import { parseSharedPage, type SharedPayload } from './parseSharedPage';

/**
 * The shared note behind a page id, or `null`.
 *
 * Fetched from the API host, NOT from `PUBLISH_ORIGIN`. The published page
 * carries the same bytes, but `server/src/app.ts`'s CORS middleware
 * deliberately skips the publish host — "a published page is not a
 * credentialed response" — so a cross-origin read of `/p/<id>` is blocked by
 * the browser. `GET /share/<id>` exists for exactly this.
 *
 * `credentials: 'omit'`, deliberately: the route is anonymous, the capability
 * is the id, and sending a session cookie would make an import look like an
 * authenticated action in the logs when it is not one. It is also what lets
 * this work for a visitor who has never signed in, which is the common case.
 *
 * Every failure collapses to `null` — a dead network, a 404, a page published
 * before the payload existed. They read the same to a user standing in front
 * of a link that does not work, and splitting them would mean writing three
 * sentences nobody can act on differently.
 */
export async function fetchSharedPage(
  id: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<SharedPayload | null> {
  const doFetch = deps.fetch ?? globalThis.fetch;

  try {
    const response = await doFetch(`${API_ORIGIN}/share/${encodeURIComponent(id)}`, {
      credentials: 'omit',
    });
    if (!response.ok) return null;
    return parseSharedPage(await response.text());
  } catch {
    return null;
  }
}
