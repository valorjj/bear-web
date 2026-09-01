/**
 * Where the sync service lives.
 *
 * The app and the API are same-site but different origins, which is the whole
 * reason the app moved to the apex: it makes the session cookie possible.
 * Overridable through `VITE_API_ORIGIN` so a fork can point elsewhere without
 * a code change.
 */
export const API_ORIGIN: string =
  (import.meta.env.VITE_API_ORIGIN as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.markflowing.com');

/**
 * Where published pages are served from — a different host than
 * `API_ORIGIN` on purpose (`server/src/middleware/publishHost.ts` answers
 * nothing but `/p/*` and `/health` on it). `listPublished` returns bare ids
 * with no `url` field (only the POST `/publish` response carries one), so a
 * page recovered after a reload needs this to reconstruct a showable,
 * copyable link: `${PUBLISH_ORIGIN}/p/${id}`.
 */
export const PUBLISH_ORIGIN: string =
  (import.meta.env.VITE_PUBLISH_ORIGIN as string | undefined) ??
  (import.meta.env.DEV ? 'http://pub.localhost:8787' : 'https://pub.markflowing.com');

/**
 * Whether this browser has ever completed a sign-in.
 *
 * Lives HERE rather than in `src/features/account/` because both sides need
 * it and only one direction is allowed: `src/data/` must not import from
 * `src/features/`. `useSession` imports it from here.
 *
 * It gates every cross-origin request the app makes on boot — a visitor who
 * has never signed in must produce none at all, or `e2e/smoke.spec.ts` goes
 * red on `net::ERR_NAME_NOT_RESOLVED` and every offline user gets a console
 * error.
 */
export const SESSION_HINT_KEY = 'bear-web:account:hasSession';

/**
 * `localStorage` throws outright in some contexts — a private window, a
 * browser set to block site data, a thumbnail capture — so every read is
 * wrapped. Absent is the safe answer: it means "make no request".
 */
export function hasSignedInBefore(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}
