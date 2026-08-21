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
