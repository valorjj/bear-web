import type { AppDeps, Query } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';

/**
 * A signed-in test harness that needs no database.
 *
 * `sync.test.ts` and `account.test.ts` prove their routes against a real
 * MariaDB (`describe.skipIf(!url)`), which is right for repository-level
 * behaviour but wrong for `export.ts`: that route's only DB interaction is
 * `authenticator`'s session lookup, and everything else worth testing here —
 * the cap ordering, the renderer's status codes, the 401 — has nothing to do
 * with SQL. `fakeQuery` stands in for that lookup without a real row or a
 * real hash, and deliberately does not inspect the SQL text it is given —
 * `authenticator` issues exactly one read (whose result decides the user id)
 * followed by one write it never inspects the result of, so a query stub
 * that answers every call the same way is a faithful double. The
 * `authenticated: false` case is exercised by omitting the cookie entirely,
 * which returns null before any query runs at all.
 */
export const APP_ORIGIN = 'http://localhost:5173';

const TEST_TOKEN = 'test-session-token';

function fakeQuery(authenticated: boolean): Query {
  const rows = authenticated ? [{ user_id: 'user-1' }] : [];
  return async (): Promise<unknown[]> => rows;
}

export interface SignedInDepsOptions {
  /** Defaults to true. Set false to build deps for an unauthenticated caller. */
  authenticated?: boolean;
  /** Stands in for the renderer. Defaults to a fetch that always 502s. */
  rendererFetch?: typeof globalThis.fetch;
}

export async function signedInDeps(options: SignedInDepsOptions = {}): Promise<AppDeps> {
  const authenticated = options.authenticated ?? true;
  const query = fakeQuery(authenticated);

  return {
    env: {
      appOrigin: APP_ORIGIN,
      apiOrigin: 'http://localhost:8787',
      databaseUrl: '',
      googleClientId: 'id',
      googleClientSecret: 'secret',
      pdfRendererUrl: 'http://127.0.0.1:8788',
      imageRoot: './data/test-images',
    },
    query,
    transaction: async (run) => run(query),
    fetch: options.rendererFetch ?? (async () => new Response(null, { status: 502 })),
    secureCookies: false,
  };
}

/**
 * Adds the origin header every non-safe request needs to pass `originGuard`,
 * plus the session cookie `fakeQuery` recognises. The origin header is not
 * optional: `originGuard` 403s a POST with no `Origin` before auth even
 * runs, so a 401 test that forgot it would see 403 instead and could still
 * look "correct" if it only asserted `!== 200`.
 */
export function withSessionCookie(init: RequestInit = {}): RequestInit {
  const name = cookieName(SESSION_COOKIE, false);
  return {
    ...init,
    headers: {
      origin: APP_ORIGIN,
      cookie: `${name}=${TEST_TOKEN}`,
      ...init.headers,
    },
  };
}

/** Just the origin header, for requests that must fail authentication. */
export function withOrigin(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { origin: APP_ORIGIN, ...init.headers },
  };
}
