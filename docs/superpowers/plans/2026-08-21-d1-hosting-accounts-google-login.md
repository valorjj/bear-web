# D1 — Hosting, Accounts, and Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the app to `markflowing.com` and stand up an authenticated HTTP
service at `api.markflowing.com` where a user can sign in with Google, see who
they are signed in as, sign out, and delete their account — with **no note data
crossing the network**.

**Architecture:** A new `server/` directory in this repo becomes a fifth
tsconfig project: a Hono service on Node, plain SQL against its own MariaDB
container, and hand-rolled OAuth2 Authorization Code + PKCE. The session is an
opaque token in a `sessions` row, delivered as an `HttpOnly` host-only cookie on
`api.markflowing.com` — which works only because the app moves to the apex
`markflowing.com` and the two become same-site. The client gains
`src/features/account/`, whose session fetch happens after first paint and can
never block rendering.

**Tech Stack:** Hono, `@hono/node-server`, `mysql2`, `tsx`, MariaDB 11.8 in
Docker, Vitest (a new `server` project with the `node` environment), Cloudflare
Tunnel, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-21-d-server-sync-and-oauth-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include
this section.

- **The app host is `markflowing.com` (apex). The API host is
  `api.markflowing.com`.** No `bear` prefix anywhere on the public surface.
- **The repo directory, the package name, and `DATABASE_NAME = 'bear-web'` are
  NOT renamed.** Out of scope.
- **Boot order is a guarantee, not an implementation detail.** `main.tsx` stays
  `openDatabase()` then `createRoot`. Nothing in D1 may be awaited on the render
  path. If the session fetch throws, hangs, or cannot resolve DNS, the app has
  already rendered.
- **Google first, then GitHub. Naver is dropped from D.**
- **Session:** opaque random token, **not a JWT**; a row in `sessions` so it is
  revocable. Cookie is `HttpOnly; Secure; SameSite=Lax`, **host-only on
  `api.markflowing.com`** — no `Domain=` attribute. 30-day rolling expiry.
- **The redirect URI is on the API host:**
  `https://api.markflowing.com/auth/google/callback`. This is what keeps the
  code exchange and the client secret server-side.
- **Identities are NEVER linked by matching email address.** Linking happens
  only from inside an authenticated session. Signing in with GitHub after having
  used Google creates a second, empty account, and that is correct.
- **No ORM.** Plain SQL with `mysql2`; migrations are numbered `.sql` files
  applied by a small runner.
- **`server/` may import `src/data/types.ts` and nothing else under `src/`.**
  Not `src/features/`, `src/ui/`, `src/app/`, or `src/i18n/`.
- **No user-facing string is hardcoded in a component.** Everything goes through
  `useT`; `src/i18n/en.ts` defines the key type and `ko.ts` is
  `Record<TranslationKey, string>`, so a missing translation is a compile error.
  Never weaken that annotation — add the translation.
- **Every colour comes from a CSS custom property.** Literal hex or `rgb()`
  outside `src/styles/tokens.css` is a defect.
- **Secrets never enter git.** `server/.env` is gitignored from its first
  commit; `server/.env.example` carries the key names with empty values.
- **All six gates must pass before any commit:** `npm run lint`,
  `npm run format`, `npm run typecheck`, `npm test`, `npm run test:e2e`,
  `npm run build`.
- **Before trusting any e2e result that follows a source change:**
  `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` hardcodes port 4173
  with `reuseExistingServer`, and a stale preview server silently tests a stale
  build.

## Not in D1

Named so no task drifts into them. All belong to **D2**:

- Any note, tag, or tombstone table; any `/sync` endpoint; the revision counter
  logic; Dexie version 3 and `syncState`; the conflict copy; the sync status
  indicator; the guest-note adoption dialog.
- **The per-user quota.** The spec requires it day-one, and it is a byte cap on
  note text — there is no note text on the server until D2. `users.rev_counter`
  is created in Task 4 so D2 needs no migration for it, but **quota enforcement
  is a D2 task and must be listed in D2's plan.**

`DELETE /account` IS in D1 (Task 8) and deletes what exists in D1. D2 extends it.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `public/CNAME` | The apex hostname, copied into `dist/` by Vite so Pages serves the custom domain |
| `scripts/hosting.test.ts` | Asserts `base` is `/` and `CNAME` holds the apex — the config that silently breaks the deployed app |
| `tsconfig.server.json` | Fifth tsconfig project: `server/`, `node` types, no DOM |
| `server/.env.example` | Key names, empty values. The shape lives in git; the secrets never do |
| `server/src/env.ts` | Reads and validates process env once, at boot. Fails loudly on a missing key |
| `server/src/app.ts` | Builds the Hono app from injected dependencies. No listening, so tests need no port |
| `server/src/index.ts` | The entry point: real env, real pool, `serve()` |
| `server/src/db/pool.ts` | The `mysql2` pool and a thin `query` helper |
| `server/src/db/migrate.ts` | Applies numbered `.sql` files, tracked in `schema_migrations` |
| `server/migrations/001_init.sql` | `users`, `identities`, `sessions`, `schema_migrations` |
| `server/src/repositories/users.ts` | `findOrCreateUserByIdentity`, `linkIdentity`, `deleteUser` |
| `server/src/repositories/sessions.ts` | `createSession`, `findSession`, `revokeSession`, `revokeAllForUser` |
| `server/src/auth/cookies.ts` | Cookie serialisation: session cookie and the short-lived OAuth transaction cookie |
| `server/src/auth/pkce.ts` | `state`, PKCE verifier and S256 challenge |
| `server/src/auth/google.ts` | The Google provider: authorize URL, code exchange, claim extraction |
| `server/src/auth/routes.ts` | `/auth/google`, `/auth/google/callback`, `/auth/logout` |
| `server/src/middleware/origin.ts` | CSRF: `Origin` allowlist on mutating methods |
| `server/src/middleware/rateLimit.ts` | In-memory sliding window, per IP and per user |
| `server/src/routes/account.ts` | `GET /me`, `DELETE /account` |
| `server/docker-compose.yml` | `markflowing-mariadb` with its own named volume |
| `scripts/serverBoundaries.test.ts` | `server/` import boundary, and the SQL tenancy guard |
| `src/features/account/config.ts` | Resolves the API origin for dev and production |
| `src/features/account/api.ts` | The typed fetch client. `credentials: 'include'` in exactly one place |
| `src/features/account/useSession.ts` | Session state hook. Fetches after mount, never on the render path |
| `src/features/account/AccountMenu.tsx` | Sidebar-footer trigger, sign-in row, signed-in identity, sign-out |
| `src/features/account/index.ts` | The feature's public surface |

**Modified:**

| File | Change |
| --- | --- |
| `vite.config.ts` | `base` becomes `'/'` unconditionally; `test` gains two Vitest projects |
| `tsconfig.json` | A fourth reference: `./tsconfig.server.json` |
| `package.json` | Server deps, and `server:dev` / `server:migrate` scripts |
| `.gitignore` | `server/.env` |
| `.github/workflows/ci.yml` | A `mariadb` service and `TEST_DATABASE_URL` |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | The `account.*` keys |
| `src/app/AppShell.tsx` | `<AccountMenu />` in the sidebar footer beside `<ThemePicker />` |
| `CLAUDE.md` | Status row, the new architecture boundary, the new toolchain surprises |

---

### Task 1: Move the app to the apex

`vite.config.ts` currently reads
`base: process.env.GITHUB_ACTIONS ? '/bear-web/' : '/'`. On a custom domain the
deployed path is `/`, so the conditional disappears rather than changing value —
**this is simpler than the spec's description of it.**

This task must land before the Google OAuth client is registered, because the
app origin is part of that registration.

**Files:**

- Modify: `vite.config.ts:10`
- Create: `public/CNAME`
- Create: `scripts/hosting.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the app is served from `/` in every environment. Later tasks assume
  the app origin is `https://markflowing.com` and `http://localhost:5173` in dev.

- [ ] **Step 1: Write the failing test**

Create `scripts/hosting.test.ts`:

```ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Two facts that break the deployed site silently and are invisible to every
 * other test: the unit suite has no notion of a base path, and the Playwright
 * suite drives a preview server that happily serves whatever base was built.
 * A wrong `base` renders a blank page with 404s for every asset; a missing
 * CNAME quietly reverts Pages to `valorjj.github.io`, which is a DIFFERENT
 * SITE from the API host and therefore silently breaks the session cookie.
 */
describe('hosting', () => {
  it('serves from the domain root, not a repo subpath', () => {
    const config = readFileSync('vite.config.ts', 'utf8');

    expect(config).not.toContain('/bear-web/');
    expect(config).toMatch(/base:\s*'\/'/);
  });

  it('claims the apex domain for GitHub Pages', () => {
    // Vite copies `public/` verbatim into `dist/`, which is how Pages sees it.
    expect(readFileSync('public/CNAME', 'utf8').trim()).toBe('markflowing.com');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run scripts/hosting.test.ts
```

Expected: both fail — the first on `/bear-web/` still being present, the second
with `ENOENT` because `public/` does not exist.

- [ ] **Step 3: Create the CNAME file**

```bash
mkdir -p public
printf 'markflowing.com\n' > public/CNAME
```

- [ ] **Step 4: Change the base path**

In `vite.config.ts`, replace these two lines:

```ts
  // GitHub Pages serves the site from /<repo-name>/. Local dev serves from /.
  base: process.env.GITHUB_ACTIONS ? '/bear-web/' : '/',
```

with:

```ts
  // Served from the apex `markflowing.com`, so the base is the domain root in
  // every environment. It was `/bear-web/` under GITHUB_ACTIONS while Pages
  // served `valorjj.github.io/bear-web/`; the conditional is gone rather than
  // retargeted, because there is no longer an environment with a path prefix.
  base: '/',
```

- [ ] **Step 5: Run the test and the full build**

```bash
npx vitest run scripts/hosting.test.ts
npm run build
grep -c 'src="/assets' dist/index.html
```

Expected: tests PASS; build succeeds; the grep finds at least 1 — asset URLs are
now absolute from the root with no `/bear-web/` prefix.

- [ ] **Step 6: Verify the e2e suite still passes against the new base**

The preview server serves `/` now instead of `/bear-web/` in CI. Kill any stale
server first, or you will test the previous build:

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
```

Expected: all 72 pass. If any fail on navigation, a spec is hardcoding
`/bear-web/` — fix the spec, do not restore the base.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts public/CNAME scripts/hosting.test.ts
git commit -m "feat: serve the app from the markflowing.com apex

The base path conditional is deleted rather than retargeted: there is no
longer an environment with a path prefix. The CNAME must exist for Pages
to keep the custom domain, and losing it reverts to valorjj.github.io,
which is a different SITE from api.markflowing.com and would silently
break the session cookie D1 depends on."
```

- [ ] **Step 8: Human step — configure DNS and Pages**

Not a code change; record completion here.

1. Confirm the **Down `markflowing` tunnel** does not route the apex. If it
   does, resolve that before continuing.
2. Cloudflare DNS: `markflowing.com` → `valorjj.github.io` (CNAME flattening
   handles the apex).
3. **If the record is proxied, set SSL mode to Full, not Flexible.** Flexible
   produces a redirect loop, and this is the most common failure of this exact
   setup.
4. GitHub repo → Settings → Pages → Custom domain: `markflowing.com`.

---

### Task 2: Scaffold `server/` as a fifth tsconfig project

Nothing in this task touches the database or auth. It ends with a health
endpoint and a passing test that runs in the **node** environment — which is the
point: the app's Vitest setup swaps the global `Blob` for Node's and installs
jsdom, and none of that may leak into server tests.

**Files:**

- Modify: `package.json`
- Create: `tsconfig.server.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts` (the `test` block)
- Create: `server/src/env.ts`
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Create: `server/.env.example`
- Modify: `.gitignore`
- Test: `server/src/app.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `createApp(deps: AppDeps): Hono` — every later task adds routes through this
    single factory, so tests never open a port.
  - `interface AppDeps { env: Env; query: Query }`
  - `interface Env` with `appOrigin: string`, `apiOrigin: string`,
    `databaseUrl: string`, `googleClientId: string`, `googleClientSecret: string`
  - `readEnv(source: Record<string, string | undefined>): Env`

- [ ] **Step 1: Install the server dependencies**

```bash
npm install hono @hono/node-server mysql2
npm install --save-dev tsx
```

- [ ] **Step 2: Add the tsconfig project**

Create `tsconfig.server.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.server.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "strict": true,
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["server"]
}
```

`"lib"` deliberately omits `DOM`: a `document` or `window` reference in server
code must fail typecheck, the same way `process.env` under `src/` must.

Add the reference in `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.e2e.json" },
    { "path": "./tsconfig.server.json" }
  ]
}
```

- [ ] **Step 3: Split Vitest into two projects**

In `vite.config.ts`, replace the whole `test: { … }` block with:

```ts
  test: {
    /*
     * Two projects, because the environments are genuinely incompatible.
     * `vitest.setup.ts` installs jsdom and swaps the global `Blob` for Node's
     * so fake-indexeddb can structuredClone it — behaviour the app suite
     * depends on and the server suite must never see. The server project
     * therefore does NOT `extend`, so it inherits no setup file, no jsdom, and
     * no `globals`.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          css: true,
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
        },
      },
    ],
  },
```

- [ ] **Step 4: Write the failing test**

Create `server/src/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import { readEnv } from './env.ts';

const ENV = {
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:8787',
  DATABASE_URL: 'mysql://root:root@127.0.0.1:3308/markflowing',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
};

function app() {
  return createApp({
    env: readEnv(ENV),
    query: async () => [],
  });
}

describe('readEnv', () => {
  it('reads every required key', () => {
    expect(readEnv(ENV).appOrigin).toBe('http://localhost:5173');
  });

  it('names the missing key rather than failing later', () => {
    // A server that boots without GOOGLE_CLIENT_SECRET fails at the first
    // login attempt with an opaque provider error. Failing at boot with the
    // key's name is the difference between a five-second fix and an hour.
    expect(() => readEnv({ ...ENV, GOOGLE_CLIENT_SECRET: undefined })).toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
  });
});

describe('health', () => {
  it('reports ok', async () => {
    const response = await app().request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('the node environment', () => {
  it('has no DOM', () => {
    // Guards the project split itself. If the server suite ever inherits the
    // app project's jsdom environment, this passes silently becoming a lie
    // about what these tests prove — so assert the absence directly.
    expect(globalThis).not.toHaveProperty('document');
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run --project server
```

Expected: FAIL — cannot resolve `./app.ts` or `./env.ts`.

- [ ] **Step 6: Write `server/src/env.ts`**

```ts
export interface Env {
  appOrigin: string;
  apiOrigin: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
}

type Source = Record<string, string | undefined>;

function require_(source: Source, key: string): string {
  const value = source[key];
  if (value === undefined || value === '') throw new Error(`missing env: ${key}`);
  return value;
}

/**
 * Validates the whole environment once, at boot.
 *
 * Every value is read here rather than at its point of use, so a
 * misconfiguration is a startup failure naming the key instead of a runtime
 * failure inside an OAuth callback, where the only visible symptom is a
 * provider error page the user cannot act on.
 */
export function readEnv(source: Source): Env {
  return {
    appOrigin: require_(source, 'APP_ORIGIN'),
    apiOrigin: require_(source, 'API_ORIGIN'),
    databaseUrl: require_(source, 'DATABASE_URL'),
    googleClientId: require_(source, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: require_(source, 'GOOGLE_CLIENT_SECRET'),
  };
}
```

- [ ] **Step 7: Write `server/src/app.ts`**

```ts
import { Hono } from 'hono';

import type { Env } from './env.ts';

/** A parameterised SQL call. The only shape route code may use. */
export type Query = (sql: string, params?: readonly unknown[]) => Promise<unknown[]>;

export interface AppDeps {
  env: Env;
  query: Query;
}

/**
 * Builds the app from injected dependencies and does not listen.
 *
 * Hono's `app.request()` drives a built app in-process, so every route test
 * runs without a port — which matters more than usual here: two parallel test
 * runs on one port is exactly the failure `playwright.config.ts` already
 * documents for 4173.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  // Routes are added here by later tasks. `deps` is referenced so this
  // signature is load-bearing from the first commit rather than growing a
  // parameter later.
  void deps;

  return app;
}
```

- [ ] **Step 8: Write `server/src/index.ts`**

```ts
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { createPool } from './db/pool.ts';
import { readEnv } from './env.ts';

const env = readEnv(process.env);
const { query } = createPool(env.databaseUrl);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp({ env, query }).fetch, port });

console.log(`listening on http://localhost:${port}`);
```

This imports `./db/pool.ts`, which Task 4 creates. Until then `index.ts` does
not typecheck — so create the file in **Step 9** as a stub and let Task 4 fill
it in.

- [ ] **Step 9: Stub the pool so the project typechecks**

Create `server/src/db/pool.ts`:

```ts
import type { Query } from '../app.ts';

export interface Pool {
  query: Query;
  end: () => Promise<void>;
}

/** Replaced with the real mysql2 pool in Task 4. */
export function createPool(databaseUrl: string): Pool {
  void databaseUrl;
  throw new Error('createPool is implemented in Task 4');
}
```

- [ ] **Step 10: Write the env example and gitignore the real one**

Create `server/.env.example`:

```
# Copy to server/.env and fill in. server/.env is gitignored and must stay so.
APP_ORIGIN=http://localhost:5173
API_ORIGIN=http://localhost:8787
DATABASE_URL=mysql://markflowing:markflowing@127.0.0.1:3308/markflowing

# Google Cloud Console -> Credentials -> OAuth client ID -> Web application.
# Authorized JavaScript origin:  http://localhost:5173
# Authorized redirect URI:       http://localhost:8787/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Append to `.gitignore`:

```
# Provider secrets. server/.env.example carries the shape; this carries the
# values and must never be committed.
server/.env
```

- [ ] **Step 11: Add the scripts**

In `package.json`, add to `scripts`:

```json
    "server:dev": "tsx watch --env-file=server/.env server/src/index.ts",
    "server:migrate": "tsx --env-file=server/.env server/src/db/migrate.ts",
```

- [ ] **Step 12: Run everything**

```bash
npx vitest run --project server
npm run typecheck
npm test
```

Expected: server tests PASS; typecheck clean across four projects; the app suite
still reports its full count. **Check the exit code, not the pass count** —
unhandled errors make `vitest run` exit 1 even when every assertion passes.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.server.json \
        vite.config.ts .gitignore server/
git commit -m "feat(server): scaffold server/ as a fifth tsconfig project

Vitest splits into app and server projects. The server project
deliberately does not extend the root config: vitest.setup.ts installs
jsdom and swaps the global Blob for Node's so fake-indexeddb can clone
it, and none of that may leak into server tests. A test asserts the
absence of document so the split cannot silently collapse.

tsconfig.server.json omits the DOM lib, so a window reference in server
code fails typecheck the way process.env under src/ already does."
```

---

### Task 3: Enforce the server's boundaries in a test

CLAUDE.md's boundaries are enforced by `scripts/sourceLint.test.ts`, not by
documentation — the `src/ui` rule existed only as a comment for two milestones,
and a violating import would simply have worked. The new directory gets the same
treatment before it has anything worth protecting, plus the multi-tenancy guard
the spec calls for.

**Files:**

- Create: `scripts/serverBoundaries.test.ts`

**Interfaces:**

- Consumes: `server/` exists (Task 2).
- Produces: `USER_SCOPED_TABLES` and the `/* tenancy-ok: … */` escape-hatch
  convention, which every later SQL-writing task must satisfy.

- [ ] **Step 1: Write the failing test**

Create `scripts/serverBoundaries.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function walk(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    return extensions.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

const sources = walk('server', ['.ts']).filter((path) => !/\.test\.ts$/.test(path));

describe('server boundaries', () => {
  it('scans a non-trivial number of files', () => {
    // Guards the guard. A typo'd directory name would make every assertion
    // below vacuously true, which is the exact failure sourceLint.test.ts
    // documents for its own boundary walk.
    expect(sources.length, 'server/ looks empty').toBeGreaterThan(1);
  });

  it('reaches only src/data/types.ts under src/', () => {
    const offenders = sources.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return [...source.matchAll(/from\s+'([^']+)'/g)]
        .map((match) => match[1]!)
        .filter((specifier) => specifier.includes('src/'))
        .filter((specifier) => !specifier.endsWith('src/data/types.ts'))
        .map((specifier) => `${path} imports ${specifier}`);
    });

    expect(
      offenders,
      'the server shares types with the client and nothing else',
    ).toEqual([]);
  });

  it('has no DOM reference', () => {
    const offenders = sources.filter((path) =>
      /\b(document|window|localStorage)\./.test(readFileSync(path, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * The multi-tenancy guard.
 *
 * In a multi-tenant app one forgotten `WHERE user_id = ?` is a cross-user
 * notes leak, and that is not a class of bug to catch by review. Every SQL
 * statement naming a user-scoped table must either constrain `user_id` or
 * carry an explicit `tenancy-ok` annotation saying why it does not.
 *
 * The escape hatch is deliberate: some statements are legitimately unscoped
 * (creating a user, looking up an identity to FIND the user, expiring sessions
 * by time). Forcing them to lie about a `user_id` predicate would be worse
 * than making the exception visible and reviewable.
 */
const USER_SCOPED_TABLES = ['sessions', 'identities'] as const;

describe('multi-tenancy guard', () => {
  it('constrains user_id in every statement touching a user-scoped table', () => {
    const offenders = sources.flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n');

      return lines.flatMap((line, index) => {
        const names = USER_SCOPED_TABLES.some((table) =>
          new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(line),
        );
        if (!names) return [];
        if (/user_id/.test(line)) return [];

        // The annotation may sit on the statement's line or the line above it,
        // because a multi-line template literal often has no room on its own.
        const context = `${lines[index - 1] ?? ''}\n${line}`;
        if (/tenancy-ok:/.test(context)) return [];

        return [`${path}:${index + 1}  ${line.trim()}`];
      });
    });

    expect(
      offenders,
      'add `user_id = ?` or an explicit `/* tenancy-ok: reason */`',
    ).toEqual([]);
  });

  it('fails on an unscoped statement', () => {
    // Falsification. The guard above passes trivially while no SQL exists at
    // all, so prove the predicate rejects the thing it claims to reject.
    const line = 'const sql = `SELECT * FROM sessions WHERE created_at > ?`;';

    const names = USER_SCOPED_TABLES.some((table) =>
      new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(line),
    );

    expect(names).toBe(true);
    expect(/user_id/.test(line)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run scripts/serverBoundaries.test.ts
```

Expected: PASS. Every assertion is currently satisfied by a `server/` that holds
only `env.ts`, `app.ts`, `index.ts` and the pool stub — which is why the two
guard-the-guard tests exist in the same file.

- [ ] **Step 3: Prove the import boundary can fail**

Inject a fault, confirm red, then revert. **Do not skip this** — the boundary
test that shipped as a comment for two milestones is the reason this repo
verifies by injection.

```bash
printf "\nimport { db } from '../../src/data/db.ts';\nvoid db;\n" >> server/src/env.ts
npx vitest run scripts/serverBoundaries.test.ts
```

Expected: FAIL naming `server/src/env.ts imports ../../src/data/db.ts`.

```bash
git checkout server/src/env.ts
npx vitest run scripts/serverBoundaries.test.ts
```

Expected: PASS again.

- [ ] **Step 4: Commit**

```bash
git add scripts/serverBoundaries.test.ts
git commit -m "test: enforce the server boundary and the tenancy guard

Installed before there is anything to protect, deliberately. The src/ui
rule existed only as a comment for two milestones and a violating import
would simply have worked.

The tenancy guard requires every statement naming a user-scoped table to
constrain user_id or carry an explicit tenancy-ok annotation. The escape
hatch is intentional: creating a user and looking up an identity are
legitimately unscoped, and forcing them to fake a predicate would be
worse than making the exception reviewable."
```

---

### Task 4: MariaDB, the migration runner, and the schema

The first task with a real database. Integration tests run against **real
MariaDB** — SQL tested against a mock proves nothing — and a guard test ensures
CI can never silently skip them.

**Files:**

- Create: `server/docker-compose.yml`
- Create: `server/migrations/001_init.sql`
- Create: `server/src/db/migrate.ts`
- Modify: `server/src/db/pool.ts` (replace the Task 2 stub)
- Modify: `.github/workflows/ci.yml`
- Test: `server/src/db/migrate.test.ts`

**Interfaces:**

- Consumes: `Query` and `Pool` from Task 2.
- Produces:
  - `createPool(databaseUrl: string): Pool` — real, backed by `mysql2/promise`
  - `migrate(query: Query, dir?: string): Promise<string[]>` — returns the
    names of the migrations it applied, empty when already current
  - `testPool(): Pool | null` — returns null when `TEST_DATABASE_URL` is unset
  - Tables `users`, `identities`, `sessions`, `schema_migrations`

- [ ] **Step 1: Write the compose file**

Create `server/docker-compose.yml`:

```yaml
# Its own instance and its own volume, deliberately not the existing
# lunch-select-mariadb: notes must never share an availability, upgrade or wipe
# fate with an unrelated project. Port 3308 avoids that container's 3307.
services:
  mariadb:
    image: mariadb:11.8
    container_name: markflowing-mariadb
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD:-root}
      MARIADB_DATABASE: markflowing
      MARIADB_USER: markflowing
      MARIADB_PASSWORD: ${MARIADB_PASSWORD:-markflowing}
    ports:
      - '3308:3306'
    volumes:
      - markflowing-data:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized']
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  markflowing-data:
```

- [ ] **Step 2: Write the schema**

Create `server/migrations/001_init.sql`:

```sql
-- D1: accounts only. No note data exists on the server until D2.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at BIGINT       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  created_at  BIGINT   NOT NULL,
  -- D2's per-user monotonic revision counter. Created here so D2 needs no
  -- migration for it; nothing in D1 reads or increments it.
  rev_counter BIGINT   NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Identity is a separate table from user from day one, so Google and GitHub
-- identities can both point at one account without a later migration.
CREATE TABLE identities (
  provider         VARCHAR(32)  NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  email            VARCHAR(320) NULL,
  user_id          CHAR(36)     NOT NULL,
  created_at       BIGINT       NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  KEY idx_identities_user (user_id),
  CONSTRAINT fk_identities_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- `id` is the SHA-256 of the token in the cookie, never the token itself: a
-- database leak must not hand over live sessions.
CREATE TABLE sessions (
  id           CHAR(64) NOT NULL PRIMARY KEY,
  user_id      CHAR(36) NOT NULL,
  created_at   BIGINT   NOT NULL,
  expires_at   BIGINT   NOT NULL,
  last_seen_at BIGINT   NOT NULL,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 3: Write the failing test**

Create `server/src/db/migrate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool, type Pool } from './pool.ts';
import { migrate } from './migrate.ts';

const url = process.env.TEST_DATABASE_URL;

describe('the integration suite is not silently skipped', () => {
  it('has a database URL whenever CI is set', () => {
    // The failure this prevents: CI reports green because every database test
    // skipped. A fault injection that "passed" for this reason cost M9a a
    // wrong diagnosis, so the skip condition itself is asserted.
    if (process.env.CI) expect(url, 'CI must set TEST_DATABASE_URL').toBeTruthy();
    else expect(true).toBe(true);
  });
});

describe.skipIf(!url)('migrate', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(url!);
    await pool.query('DROP TABLE IF EXISTS sessions');
    await pool.query('DROP TABLE IF EXISTS identities');
    await pool.query('DROP TABLE IF EXISTS users');
    await pool.query('DROP TABLE IF EXISTS schema_migrations');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies every migration once', async () => {
    const first = await migrate(pool.query);
    expect(first).toContain('001_init.sql');

    const second = await migrate(pool.query);
    expect(second, 'a second run must be a no-op').toEqual([]);
  });

  it('creates the three account tables', async () => {
    await migrate(pool.query);

    const rows = (await pool.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE()`,
    )) as Array<{ name: string }>;
    const names = rows.map((row) => row.name.toLowerCase());

    expect(names).toContain('users');
    expect(names).toContain('identities');
    expect(names).toContain('sessions');
  });

  it('cascades identities and sessions when a user is deleted', async () => {
    await migrate(pool.query);
    const now = Date.now();

    await pool.query('INSERT INTO users (id, created_at) VALUES (?, ?)', ['u1', now]);
    await pool.query(
      `INSERT INTO identities (provider, provider_subject, email, user_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['google', 'sub-1', 'a@example.com', 'u1', now],
    );
    await pool.query(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['a'.repeat(64), 'u1', now, now + 1000, now],
    );

    await pool.query('DELETE FROM users WHERE id = ?', ['u1']);

    /* tenancy-ok: asserting the cascade removed the rows FOR this user. */
    const left = (await pool.query(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?',
      ['u1'],
    )) as Array<{ n: number }>;

    // The cascade is what makes DELETE /account correct rather than a list of
    // deletes someone must remember to extend in D2.
    expect(Number(left[0]!.n)).toBe(0);
  });
});
```

- [ ] **Step 4: Start the database and run the test to watch it fail**

```bash
docker compose -f server/docker-compose.yml up -d
export TEST_DATABASE_URL='mysql://markflowing:markflowing@127.0.0.1:3308/markflowing'
npx vitest run --project server
```

Expected: FAIL — `createPool` throws `createPool is implemented in Task 4`.

- [ ] **Step 5: Implement the pool**

Replace `server/src/db/pool.ts` entirely:

```ts
import mysql from 'mysql2/promise';

import type { Query } from '../app.ts';

export interface Pool {
  query: Query;
  end: () => Promise<void>;
}

/**
 * The mysql2 pool, exposed as a single parameterised `query`.
 *
 * Route code never sees the driver: it gets `Query` and nothing else, so a
 * string-concatenated statement has no convenient path into existence and the
 * tenancy guard in `scripts/serverBoundaries.test.ts` has a single grammar to
 * scan for.
 */
export function createPool(databaseUrl: string): Pool {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    namedPlaceholders: false,
    // BIGINT columns come back as JS numbers rather than strings. Every BIGINT
    // here is an epoch-millisecond timestamp, comfortably inside Number's
    // exact-integer range until the year 287396.
    supportBigNumbers: true,
    bigNumberStrings: false,
  });

  const query: Query = async (sql, params = []) => {
    const [rows] = await pool.query(sql, params as unknown[]);
    return Array.isArray(rows) ? (rows as unknown[]) : [];
  };

  return { query, end: () => pool.end() };
}
```

- [ ] **Step 6: Implement the migration runner**

Create `server/src/db/migrate.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { Query } from '../app.ts';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Applies numbered `.sql` files in name order, recording each in
 * `schema_migrations`.
 *
 * No ORM and no migration library: the data model is four tables, and a
 * dependency to manage four tables is more machinery than the thing it
 * manages. Statements are split on `;` at end of line, which is sufficient
 * because these files contain no stored procedures — if one ever does, this
 * splitter must be replaced rather than worked around.
 */
export async function migrate(query: Query, dir: string = DEFAULT_DIR): Promise<string[]> {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at BIGINT       NOT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  const applied = new Set(
    ((await query('SELECT name FROM schema_migrations')) as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  const pending = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name));

  for (const name of pending) {
    const statements = readFileSync(join(dir, name), 'utf8')
      .split(/;\s*$/m)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) await query(statement);

    await query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [
      name,
      Date.now(),
    ]);
  }

  return pending;
}

// Run directly by `npm run server:migrate`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createPool } = await import('./pool.ts');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('missing env: DATABASE_URL');

  const pool = createPool(url);
  const names = await migrate(pool.query);
  console.log(names.length > 0 ? `applied: ${names.join(', ')}` : 'already current');
  await pool.end();
}
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run --project server
```

Expected: PASS, four tests in `migrate.test.ts`.

- [ ] **Step 8: Prove the tests would fail without the schema**

```bash
docker compose -f server/docker-compose.yml down -v
docker compose -f server/docker-compose.yml up -d
sleep 15
npx vitest run --project server
```

Expected: PASS from an empty database, which proves the migration ran rather
than the tables having survived from a previous run.

- [ ] **Step 9: Add MariaDB to CI**

In `.github/workflows/ci.yml`, add a `services` block to the `verify` job,
immediately after `runs-on: ubuntu-latest`:

```yaml
    services:
      mariadb:
        image: mariadb:11.8
        env:
          MARIADB_ROOT_PASSWORD: root
          MARIADB_DATABASE: markflowing
          MARIADB_USER: markflowing
          MARIADB_PASSWORD: markflowing
        ports:
          - 3308:3306
        options: >-
          --health-cmd="healthcheck.sh --connect --innodb_initialized"
          --health-interval=10s --health-timeout=5s --health-retries=10
```

and change the `Unit tests` step to:

```yaml
      - name: Unit tests
        run: npm test
        env:
          # Without this the database integration tests skip, and CI reports
          # green for a suite that ran nothing. `migrate.test.ts` asserts this
          # variable is present whenever CI is set, so a removal fails loudly.
          TEST_DATABASE_URL: mysql://markflowing:markflowing@127.0.0.1:3308/markflowing
```

- [ ] **Step 10: Prove the CI guard works**

```bash
CI=1 npx vitest run --project server
```

Expected: FAIL on `CI must set TEST_DATABASE_URL` when `TEST_DATABASE_URL` is
unset. Then:

```bash
CI=1 TEST_DATABASE_URL='mysql://markflowing:markflowing@127.0.0.1:3308/markflowing' \
  npx vitest run --project server
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add server/docker-compose.yml server/migrations server/src/db .github/workflows/ci.yml
git commit -m "feat(server): MariaDB, the migration runner, and the account schema

Its own container and volume rather than the existing
lunch-select-mariadb, so notes never share an availability, upgrade or
wipe fate with an unrelated project.

sessions.id is the SHA-256 of the cookie token, never the token, so a
database leak does not hand over live sessions. Identities are a separate
table from users from day one, so GitHub can be added without a
migration. ON DELETE CASCADE is what makes DELETE /account correct rather
than a list of deletes to remember extending in D2.

users.rev_counter exists unused: it is D2's revision counter, created now
so D2 needs no migration.

The integration tests run against real MariaDB, and a guard test asserts
CI sets TEST_DATABASE_URL — otherwise CI reports green for a suite that
skipped everything."
```

---

### Task 5: Users and identities

The account-linking rule lives here, and it is a security decision. The test
that matters most is the one asserting a **matching email does not link**.

**Files:**

- Create: `server/src/repositories/users.ts`
- Test: `server/src/repositories/users.test.ts`

**Interfaces:**

- Consumes: `Query` (Task 2), the schema (Task 4).
- Produces:
  - `interface Claims { provider: string; subject: string; email: string | null }`
  - `findOrCreateUserByIdentity(query: Query, claims: Claims): Promise<string>` —
    returns the user id
  - `linkIdentity(query: Query, userId: string, claims: Claims): Promise<void>`
  - `deleteUser(query: Query, userId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `server/src/repositories/users.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { deleteUser, findOrCreateUserByIdentity, linkIdentity } from './users.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('users', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a user on first sight of an identity', async () => {
    const id = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same user for the same identity', async () => {
    const claims = { provider: 'google', subject: 'sub-1', email: 'a@example.com' };

    const first = await findOrCreateUserByIdentity(pool.query, claims);
    const second = await findOrCreateUserByIdentity(pool.query, claims);

    expect(second).toBe(first);
  });

  it('does NOT link a different provider that reports the same email', async () => {
    // The security rule, and the one most likely to be "helpfully" broken by a
    // later change. A provider that admits an unverified address would
    // otherwise hand over someone else's notes.
    const google = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
    const github = await findOrCreateUserByIdentity(pool.query, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });

    expect(github).not.toBe(google);
  });

  it('links a second provider when asked explicitly', async () => {
    const userId = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    await linkIdentity(pool.query, userId, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });

    const reached = await findOrCreateUserByIdentity(pool.query, {
      provider: 'github',
      subject: '99',
      email: 'a@example.com',
    });
    expect(reached).toBe(userId);
  });

  it('refuses to link an identity already owned by another user', async () => {
    const a = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-a',
      email: 'a@example.com',
    });
    await findOrCreateUserByIdentity(pool.query, {
      provider: 'github',
      subject: '99',
      email: 'b@example.com',
    });

    await expect(
      linkIdentity(pool.query, a, { provider: 'github', subject: '99', email: null }),
    ).rejects.toThrow(/already linked/);
  });

  it('deletes the user and cascades the identity', async () => {
    const id = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });

    await deleteUser(pool.query, id);

    /* tenancy-ok: counting the rows that should no longer exist for this user. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?', [
      id,
    ])) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project server
```

Expected: FAIL — cannot resolve `./users.ts`.

- [ ] **Step 3: Implement the repository**

Create `server/src/repositories/users.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { Query } from '../app.ts';

export interface Claims {
  provider: string;
  subject: string;
  email: string | null;
}

interface IdentityRow {
  user_id: string;
}

async function findIdentity(query: Query, claims: Claims): Promise<string | null> {
  /* tenancy-ok: this lookup IS how the user is identified; it cannot filter by the user it resolves. */
  const rows = (await query(
    'SELECT user_id FROM identities WHERE provider = ? AND provider_subject = ?',
    [claims.provider, claims.subject],
  )) as IdentityRow[];

  return rows[0]?.user_id ?? null;
}

/**
 * Resolves an identity to a user, creating both on first sight.
 *
 * **Email is never used to match.** Two identities from different providers
 * reporting the same address are two accounts until the user links them from
 * inside an authenticated session. A provider that admits an unverified address
 * would otherwise be a path to someone else's notes, and "the addresses match"
 * is not proof of the same person.
 */
export async function findOrCreateUserByIdentity(query: Query, claims: Claims): Promise<string> {
  const existing = await findIdentity(query, claims);
  if (existing !== null) return existing;

  const userId = randomUUID();
  const now = Date.now();

  await query('INSERT INTO users (id, created_at) VALUES (?, ?)', [userId, now]);
  /* tenancy-ok: creating the first identity for a user that did not exist a line ago. */
  await query(
    `INSERT INTO identities (provider, provider_subject, email, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [claims.provider, claims.subject, claims.email, userId, now],
  );

  return userId;
}

/** Attaches another provider to an existing account. Callers must be authenticated. */
export async function linkIdentity(
  query: Query,
  userId: string,
  claims: Claims,
): Promise<void> {
  const owner = await findIdentity(query, claims);
  if (owner !== null && owner !== userId) {
    throw new Error('identity already linked to another account');
  }
  if (owner === userId) return;

  await query(
    `INSERT INTO identities (provider, provider_subject, email, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [claims.provider, claims.subject, claims.email, userId, Date.now()],
  );
}

/**
 * Removes the account.
 *
 * One statement, because `identities` and `sessions` carry
 * `ON DELETE CASCADE`. D2's tables must do the same rather than extending a
 * list of deletes here — a forgotten line in such a list is data that outlives
 * the account that owned it.
 */
export async function deleteUser(query: Query, userId: string): Promise<void> {
  await query('DELETE FROM users WHERE id = ?', [userId]);
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run --project server
```

Expected: PASS, six tests in `users.test.ts`.

- [ ] **Step 5: Prove the email rule is really tested**

Break it deliberately, confirm red, revert.

In `findIdentity`, temporarily add an email fallback:

```ts
  if (rows[0] === undefined && claims.email !== null) {
    const byEmail = (await query('SELECT user_id FROM identities WHERE email = ?', [
      claims.email,
    ])) as IdentityRow[];
    if (byEmail[0] !== undefined) return byEmail[0].user_id;
  }
```

```bash
npx vitest run --project server
```

Expected: FAIL on "does NOT link a different provider that reports the same
email", **and** FAIL in `scripts/serverBoundaries.test.ts` because that new
statement names `identities` with no `user_id` and no annotation. Two independent
guards catch it. Then revert:

```bash
git checkout server/src/repositories/users.ts 2>/dev/null || \
  echo "not yet committed — remove the block by hand"
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/users.ts server/src/repositories/users.test.ts
git commit -m "feat(server): users and identities, with no email-based linking

Identities are never matched by email address. Two providers reporting
the same address are two accounts until the user links them from inside
an authenticated session, because a provider that admits an unverified
address would otherwise be a path to someone else's notes.

Verified by injection: adding an email fallback fails both the linking
test and the tenancy guard."
```

---

### Task 6: Sessions and cookies

**Files:**

- Create: `server/src/repositories/sessions.ts`
- Create: `server/src/auth/cookies.ts`
- Test: `server/src/repositories/sessions.test.ts`
- Test: `server/src/auth/cookies.test.ts`

**Interfaces:**

- Consumes: `Query` (Task 2), the schema (Task 4).
- Produces:
  - `createSession(query: Query, userId: string): Promise<string>` — returns the
    **raw token** for the cookie; only its hash is stored
  - `findSession(query: Query, token: string): Promise<string | null>` — returns
    the user id, refreshing `last_seen_at`
  - `revokeSession(query: Query, token: string): Promise<void>`
  - `SESSION_COOKIE = 'mf_session'`
  - `sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string`
  - `clearedSessionCookie(secure: boolean): string`
  - `txCookie(value: string, secure: boolean): string`,
    `TX_COOKIE = 'mf_oauth_tx'`
  - `readCookie(header: string | undefined, name: string): string | null`

- [ ] **Step 1: Write the failing cookie test**

Create `server/src/auth/cookies.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  clearedSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  txCookie,
} from './cookies.ts';

describe('sessionCookie', () => {
  const cookie = sessionCookie('tok', 2_592_000, true);

  it('is not readable by JavaScript', () => {
    expect(cookie).toContain('HttpOnly');
  });

  it('carries no Domain attribute', () => {
    // Host-only, deliberately. A Domain=.markflowing.com cookie would be sent
    // to lunch-api and docs-api, which belong to unrelated projects.
    expect(cookie).not.toContain('Domain');
  });

  it('is Lax, not Strict', () => {
    // Strict would be dropped on the redirect back from Google, so the user
    // would land on the app still signed out. Lax is sent on top-level
    // navigation, and the app and API are same-site, so it is also sent on the
    // app's fetch calls.
    expect(cookie).toContain('SameSite=Lax');
  });

  it('is Secure and site-wide in path', () => {
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  it('drops Secure only when explicitly insecure, for http://localhost', () => {
    expect(sessionCookie('tok', 60, false)).not.toContain('Secure');
  });
});

describe('clearedSessionCookie', () => {
  it('expires immediately', () => {
    expect(clearedSessionCookie(true)).toContain('Max-Age=0');
  });
});

describe('txCookie', () => {
  it('is short-lived and Lax so it survives the provider redirect', () => {
    const cookie = txCookie('payload', true);

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toMatch(/Max-Age=6\d\d/);
  });
});

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok; b=2`, SESSION_COOKIE)).toBe('tok');
  });

  it('returns null for a missing header', () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull();
  });

  it('does not match a cookie whose name merely ends the same way', () => {
    expect(readCookie(`x_${SESSION_COOKIE}=nope`, SESSION_COOKIE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project server
```

Expected: FAIL — cannot resolve `./cookies.ts`.

- [ ] **Step 3: Implement the cookies**

Create `server/src/auth/cookies.ts`:

```ts
export const SESSION_COOKIE = 'mf_session';
export const TX_COOKIE = 'mf_oauth_tx';

/** Ten minutes: long enough for a slow consent screen, short enough to be forgettable. */
const TX_MAX_AGE = 600;

function serialise(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  // No `Domain` attribute anywhere in this file. Host-only scoping is what
  // keeps the cookie off lunch-api.markflowing.com and docs-api.markflowing.com.
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return serialise(SESSION_COOKIE, token, maxAgeSeconds, secure);
}

export function clearedSessionCookie(secure: boolean): string {
  return serialise(SESSION_COOKIE, '', 0, secure);
}

export function txCookie(value: string, secure: boolean): string {
  return serialise(TX_COOKIE, value, TX_MAX_AGE, secure);
}

export function clearedTxCookie(secure: boolean): string {
  return serialise(TX_COOKIE, '', 0, secure);
}

/**
 * Reads one cookie from a `Cookie` header.
 *
 * The name is matched against the whole segment, not with `includes`: a
 * `x_mf_session` cookie must not satisfy a read of `mf_session`.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}
```

- [ ] **Step 4: Write the failing session test**

Create `server/src/repositories/sessions.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { createSession, findSession, revokeSession } from './sessions.ts';
import { findOrCreateUserByIdentity } from './users.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('sessions', () => {
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    userId = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips a token to its user', async () => {
    const token = await createSession(pool.query, userId);

    expect(await findSession(pool.query, token)).toBe(userId);
  });

  it('stores the hash, never the token', async () => {
    // A database leak must not hand over live sessions. This is the assertion
    // that keeps that true through later refactors.
    const token = await createSession(pool.query, userId);

    /* tenancy-ok: asserting no row anywhere holds the raw token. */
    const rows = (await pool.query('SELECT id FROM sessions')) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).not.toContain(token);
    expect(rows[0]!.id).toHaveLength(64);
  });

  it('rejects an unknown token', async () => {
    expect(await findSession(pool.query, 'nope')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const token = await createSession(pool.query, userId);
    /* tenancy-ok: expiring this user's own session to test the predicate. */
    await pool.query('UPDATE sessions SET expires_at = ? WHERE user_id = ?', [1, userId]);

    expect(await findSession(pool.query, token)).toBeNull();
  });

  it('revokes a session', async () => {
    const token = await createSession(pool.query, userId);

    await revokeSession(pool.query, token);

    expect(await findSession(pool.query, token)).toBeNull();
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run --project server
```

Expected: FAIL — cannot resolve `./sessions.ts`.

- [ ] **Step 6: Implement the session repository**

Create `server/src/repositories/sessions.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

import type { Query } from '../app.ts';

/** Thirty days, rolling: `last_seen_at` moves on every authenticated request. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The cookie carries the token; the table stores its SHA-256.
 *
 * Not a JWT, deliberately: a session is a row, so logout and suspicion
 * actually revoke. And not the token itself, so a database leak yields hashes
 * rather than live sessions.
 */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(query: Query, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();

  await query(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    [hash(token), userId, now, now + SESSION_MAX_AGE_SECONDS * 1000, now],
  );

  return token;
}

export async function findSession(query: Query, token: string): Promise<string | null> {
  const now = Date.now();

  /* tenancy-ok: this lookup IS how the user is identified; it cannot filter by the user it resolves. */
  const rows = (await query('SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?', [
    hash(token),
    now,
  ])) as Array<{ user_id: string }>;

  const userId = rows[0]?.user_id ?? null;
  if (userId === null) return null;

  await query('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND user_id = ?', [
    now,
    now + SESSION_MAX_AGE_SECONDS * 1000,
    hash(token),
    userId,
  ]);

  return userId;
}

export async function revokeSession(query: Query, token: string): Promise<void> {
  /* tenancy-ok: the token identifies the row; the caller has no user id yet. */
  await query('DELETE FROM sessions WHERE id = ?', [hash(token)]);
}
```

- [ ] **Step 7: Run the tests**

```bash
npx vitest run --project server
npx vitest run scripts/serverBoundaries.test.ts
```

Expected: both PASS. The boundary run matters: every annotation added above is
checked for the first time here.

- [ ] **Step 8: Commit**

```bash
git add server/src/auth/cookies.ts server/src/auth/cookies.test.ts \
        server/src/repositories/sessions.ts server/src/repositories/sessions.test.ts
git commit -m "feat(server): opaque revocable sessions in a host-only cookie

The table stores SHA-256 of the token, never the token, so a database
leak yields hashes rather than live sessions. Not a JWT: a session is a
row, so logout actually revokes.

The cookie carries no Domain attribute — host-only scoping is what keeps
it off lunch-api and docs-api, which are unrelated projects on the same
registrable domain. SameSite=Lax rather than Strict, because Strict is
dropped on the redirect back from Google and the user would land on the
app still signed out."
```

---

### Task 7: The Google OAuth flow

The provider's token endpoint is reached through an **injected `fetch`**, so the
whole callback is testable without the network and without a real Google client.

**Files:**

- Create: `server/src/auth/pkce.ts`
- Create: `server/src/auth/google.ts`
- Create: `server/src/auth/routes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/auth/pkce.test.ts`
- Test: `server/src/auth/routes.test.ts`

**Interfaces:**

- Consumes: `createApp`/`AppDeps` (Task 2), `findOrCreateUserByIdentity`
  (Task 5), `createSession` and the cookie helpers (Task 6).
- Produces:
  - `AppDeps` gains `fetch: typeof globalThis.fetch` and `secureCookies: boolean`
  - `createState(): string`, `createVerifier(): string`,
    `challengeOf(verifier: string): string`
  - `authorizeUrl(…): string`, `exchangeCode(…): Promise<Claims>`
  - Routes `GET /auth/google`, `GET /auth/google/callback`,
    `POST /auth/logout`

- [ ] **Step 1: Write the failing PKCE test**

Create `server/src/auth/pkce.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { challengeOf, createState, createVerifier } from './pkce.ts';

describe('pkce', () => {
  it('generates a distinct state every time', () => {
    expect(createState()).not.toBe(createState());
  });

  it('generates a verifier inside RFC 7636 length limits', () => {
    const verifier = createVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('derives an S256 challenge that is not the verifier', () => {
    const verifier = createVerifier();
    const challenge = challengeOf(verifier);

    expect(challenge).not.toBe(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
  });

  it('is deterministic for a given verifier', () => {
    // Known vector from RFC 7636 appendix B.
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project server
```

Expected: FAIL — cannot resolve `./pkce.ts`.

- [ ] **Step 3: Implement PKCE**

Create `server/src/auth/pkce.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** Opaque anti-forgery value tying a callback to the browser that started it. */
export function createState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A PKCE code verifier. 32 random bytes is 43 base64url characters, the
 * minimum RFC 7636 allows and enough entropy that guessing is not the attack.
 */
export function createVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** The S256 challenge: base64url of SHA-256 of the verifier, unpadded. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
```

- [ ] **Step 4: Implement the Google provider**

Create `server/src/auth/google.ts`:

```ts
import type { Claims } from '../repositories/users.ts';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

export interface AuthorizeOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}

export function authorizeUrl(options: AuthorizeOptions): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface ExchangeOptions {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch: typeof globalThis.fetch;
}

interface TokenResponse {
  id_token?: string;
}

/**
 * Reads the claims out of an id_token WITHOUT verifying its signature.
 *
 * This is sanctioned rather than sloppy: OpenID Connect Core §3.1.3.7 permits
 * skipping verification when the token came directly from the token endpoint
 * over TLS, authenticated with the client secret — which is exactly this call.
 * The alternative is a JWKS dependency and key rotation handling for a
 * guarantee TLS already provides. **If this ever moves to a token received any
 * other way, signature verification becomes mandatory.**
 */
function claimsOf(idToken: string): Claims {
  const payload = idToken.split('.')[1];
  if (payload === undefined) throw new Error('malformed id_token');

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub?: string;
    email?: string;
  };
  if (decoded.sub === undefined) throw new Error('id_token has no sub');

  return { provider: 'google', subject: decoded.sub, email: decoded.email ?? null };
}

export async function exchangeCode(options: ExchangeOptions): Promise<Claims> {
  const response = await options.fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      code_verifier: options.verifier,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);

  const body = (await response.json()) as TokenResponse;
  if (body.id_token === undefined) throw new Error('token response has no id_token');

  return claimsOf(body.id_token);
}
```

- [ ] **Step 5: Write the failing route test**

Create `server/src/auth/routes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { readEnv } from '../env.ts';
import { SESSION_COOKIE, TX_COOKIE } from './cookies.ts';

const url = process.env.TEST_DATABASE_URL;

const ENV = {
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:8787',
  DATABASE_URL: url ?? 'mysql://unused',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
};

/** An id_token with the claims we want and a signature nobody checks. See google.ts. */
function idToken(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ sub, email })).toString('base64url');
  return `header.${payload}.signature`;
}

function stubFetch(sub = 'sub-1', email = 'a@example.com'): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify({ id_token: idToken(sub, email) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch;
}

/** Reads one Set-Cookie value by name from a response. */
function setCookie(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`) && !cookie.includes(`${name}=;`));
}

describe.skipIf(!url)('the Google flow', () => {
  let pool: Pool;

  function app(fetchImpl = stubFetch()) {
    return createApp({
      env: readEnv(ENV),
      query: pool.query,
      fetch: fetchImpl,
      secureCookies: false,
    });
  }

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('redirects to Google with PKCE and sets a transaction cookie', async () => {
    const response = await app().request('/auth/google');

    expect(response.status).toBe(302);

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8787/auth/google/callback',
    );
    // The verifier must never leave the server.
    expect(location.searchParams.get('code_verifier')).toBeNull();

    expect(setCookie(response, TX_COOKIE)).toBeDefined();
  });

  it('signs the user in and redirects to the app', async () => {
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const response = await app().request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:5173/');

    const session = setCookie(response, SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session).toContain('HttpOnly');
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    // Without this check the callback accepts a code an attacker obtained
    // elsewhere, which is the whole reason `state` exists.
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;

    const response = await app().request('/auth/google/callback?code=abc&state=forged', {
      headers: { cookie: tx },
    });

    expect(response.status).toBe(400);
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('rejects a callback with no transaction cookie at all', async () => {
    const response = await app().request('/auth/google/callback?code=abc&state=whatever');

    expect(response.status).toBe(400);
  });

  it('returns 502 when the provider fails, without creating a user', async () => {
    const start = await app().request('/auth/google');
    const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;

    const failing = (async () => new Response('nope', { status: 500 })) as typeof globalThis.fetch;
    const response = await app(failing).request(
      `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { cookie: tx } },
    );

    expect(response.status).toBe(502);

    /* tenancy-ok: asserting no user row was created by anyone. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('reuses the account on a second sign-in', async () => {
    async function signIn() {
      const start = await app().request('/auth/google');
      const tx = setCookie(start, TX_COOKIE)!.split(';')[0]!;
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      return app().request(
        `/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
        { headers: { cookie: tx } },
      );
    }

    await signIn();
    await signIn();

    /* tenancy-ok: asserting the total account count across all users. */
    const rows = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
npx vitest run --project server
```

Expected: FAIL — `createApp` rejects the extra `fetch` and `secureCookies`
deps, and `/auth/google` returns 404.

- [ ] **Step 7: Widen `AppDeps` and mount the routes**

In `server/src/app.ts`, replace the `AppDeps` interface and the body of
`createApp`:

```ts
export interface AppDeps {
  env: Env;
  query: Query;
  /** Injected so the provider's token endpoint is reachable in tests without the network. */
  fetch: typeof globalThis.fetch;
  /** False only for http://localhost, where a Secure cookie would be dropped. */
  secureCookies: boolean;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', authRoutes(deps));

  return app;
}
```

and add the import at the top:

```ts
import { authRoutes } from './auth/routes.ts';
```

- [ ] **Step 8: Implement the routes**

Create `server/src/auth/routes.ts`:

```ts
import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { createSession, revokeSession, SESSION_MAX_AGE_SECONDS } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import {
  clearedSessionCookie,
  clearedTxCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  txCookie,
  TX_COOKIE,
} from './cookies.ts';
import { authorizeUrl, exchangeCode } from './google.ts';
import { challengeOf, createState, createVerifier } from './pkce.ts';

interface Transaction {
  state: string;
  verifier: string;
}

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const redirectUri = `${deps.env.apiOrigin}/auth/google/callback`;

  app.get('/auth/google', (c) => {
    const state = createState();
    const verifier = createVerifier();

    // The transaction rides in a cookie rather than server state, so the
    // service holds nothing between the two legs and can restart mid-login.
    const transaction: Transaction = { state, verifier };
    c.header(
      'set-cookie',
      txCookie(
        Buffer.from(JSON.stringify(transaction)).toString('base64url'),
        deps.secureCookies,
      ),
    );

    return c.redirect(
      authorizeUrl({
        clientId: deps.env.googleClientId,
        redirectUri,
        state,
        challenge: challengeOf(verifier),
      }),
      302,
    );
  });

  app.get('/auth/google/callback', async (c) => {
    const raw = readCookie(c.req.header('cookie'), TX_COOKIE);
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (raw === null || code === undefined || state === undefined) {
      return c.text('invalid login transaction', 400);
    }

    let transaction: Transaction;
    try {
      transaction = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Transaction;
    } catch {
      return c.text('invalid login transaction', 400);
    }

    // Anti-forgery: without this the callback would accept a code obtained in
    // some other browser, which is the entire purpose of `state`.
    if (transaction.state !== state) return c.text('invalid login transaction', 400);

    let claims;
    try {
      claims = await exchangeCode({
        code,
        verifier: transaction.verifier,
        clientId: deps.env.googleClientId,
        clientSecret: deps.env.googleClientSecret,
        redirectUri,
        fetch: deps.fetch,
      });
    } catch {
      // No user is created on a provider failure: a half-made account whose
      // identity was never proven is worse than a retry.
      return c.text('provider rejected the exchange', 502);
    }

    const userId = await findOrCreateUserByIdentity(deps.query, claims);
    const token = await createSession(deps.query, userId);

    c.header('set-cookie', clearedTxCookie(deps.secureCookies), { append: true });
    c.header('set-cookie', sessionCookie(token, SESSION_MAX_AGE_SECONDS, deps.secureCookies), {
      append: true,
    });

    return c.redirect(`${deps.env.appOrigin}/`, 302);
  });

  app.post('/auth/logout', async (c) => {
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    if (token !== null) await revokeSession(deps.query, token);

    c.header('set-cookie', clearedSessionCookie(deps.secureCookies));
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 9: Update the entry point for the new deps**

In `server/src/index.ts`, change the `serve` call:

```ts
const app = createApp({
  env,
  query,
  fetch: globalThis.fetch,
  // http://localhost drops a Secure cookie, so dev must opt out. Anything
  // reached over https — which is everything behind the tunnel — opts in.
  secureCookies: env.apiOrigin.startsWith('https://'),
});

serve({ fetch: app.fetch, port });
```

- [ ] **Step 10: Update `app.test.ts` for the widened deps**

In `server/src/app.test.ts`, replace the `app()` helper:

```ts
function app() {
  return createApp({
    env: readEnv(ENV),
    query: async () => [],
    fetch: globalThis.fetch,
    secureCookies: false,
  });
}
```

- [ ] **Step 11: Run everything**

```bash
npx vitest run --project server
npm run typecheck
npm run lint
```

Expected: all PASS.

- [ ] **Step 12: Prove the state check can fail**

Comment out the state comparison in `routes.ts`:

```ts
    // if (transaction.state !== state) return c.text('invalid login transaction', 400);
```

```bash
npx vitest run --project server
```

Expected: FAIL on "rejects a callback whose state does not match the cookie".
Restore the line and re-run to green.

- [ ] **Step 13: Commit**

```bash
git add server/src/auth server/src/app.ts server/src/index.ts server/src/app.test.ts
git commit -m "feat(server): Google OAuth2 authorization code flow with PKCE

The redirect URI is on the API host, so the code exchange and the client
secret stay server-side and the browser never sees a provider token. The
login transaction rides in a short-lived Lax cookie rather than server
state, so the service holds nothing between legs and can restart
mid-login.

fetch is injected, so the whole callback is tested without the network
and without a real Google client. The id_token signature is deliberately
not verified: OIDC Core 3.1.3.7 permits that for a token received
directly from the token endpoint over TLS with client authentication,
which is exactly this call. That exemption is documented at the function
and does not extend to tokens received any other way.

A provider failure creates no user. Verified by injection that the state
check is load-bearing."
```

---

### Task 8: `GET /me`, `DELETE /account`, CSRF, and rate limiting

**Files:**

- Create: `server/src/middleware/origin.ts`
- Create: `server/src/middleware/rateLimit.ts`
- Create: `server/src/routes/account.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/routes/account.test.ts`
- Test: `server/src/middleware/rateLimit.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 5–7.
- Produces:
  - `GET /me` → `200 { userId, email }` when signed in, `401 { error }` when not
  - `DELETE /account` → `204`, session cleared
  - `originGuard(allowed: readonly string[])` — Hono middleware
  - `rateLimit(options: { limit: number; windowMs: number; key: (c) => string })`

- [ ] **Step 1: Write the failing account test**

Create `server/src/routes/account.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { SESSION_COOKIE } from '../auth/cookies.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { readEnv } from '../env.ts';
import { createSession } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';

const url = process.env.TEST_DATABASE_URL;

const ENV = {
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:8787',
  DATABASE_URL: url ?? 'mysql://unused',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
};

describe.skipIf(!url)('account routes', () => {
  let pool: Pool;
  let userId: string;
  let token: string;

  function app() {
    return createApp({
      env: readEnv(ENV),
      query: pool.query,
      fetch: globalThis.fetch,
      secureCookies: false,
    });
  }

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    userId = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
    token = await createSession(pool.query, userId);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('reports who is signed in', async () => {
    const response = await app().request('/me', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId, email: 'a@example.com' });
  });

  it('returns 401 with no cookie, and does not invent a user', async () => {
    const response = await app().request('/me');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a forged token', async () => {
    const response = await app().request('/me', {
      headers: { cookie: `${SESSION_COOKIE}=forged` },
    });

    expect(response.status).toBe(401);
  });

  it('deletes the account and everything cascading from it', async () => {
    const response = await app().request('/account', {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE}=${token}`,
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(204);

    /* tenancy-ok: asserting the account and its cascade are gone entirely. */
    const users = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(users[0]!.n)).toBe(0);

    /* tenancy-ok: sessions must not outlive the user they belonged to. */
    const sessions = (await pool.query('SELECT COUNT(*) AS n FROM sessions')) as Array<{
      n: number;
    }>;
    expect(Number(sessions[0]!.n)).toBe(0);
  });

  it('refuses a mutating request from a foreign origin', async () => {
    // Cookie auth means a cross-site page could otherwise trigger this with
    // the user's own credentials attached.
    const response = await app().request('/account', {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE}=${token}`,
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
    });

    expect(response.status).toBe(403);

    /* tenancy-ok: asserting the rejected request deleted nothing. */
    const users = (await pool.query('SELECT COUNT(*) AS n FROM users')) as Array<{ n: number }>;
    expect(Number(users[0]!.n)).toBe(1);
  });

  it('allows a safe request with no Origin at all', async () => {
    // A top-level GET carries no Origin in some browsers; guarding safe methods
    // would break the app rather than protect it.
    const response = await app().request('/me', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });

    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Write the failing rate-limit test**

Create `server/src/middleware/rateLimit.test.ts`:

```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { rateLimit } from './rateLimit.ts';

function app() {
  const instance = new Hono();
  instance.use('*', rateLimit({ limit: 2, windowMs: 60_000, key: () => 'fixed' }));
  instance.get('/x', (c) => c.text('ok'));
  return instance;
}

describe('rateLimit', () => {
  it('allows requests up to the limit and then refuses', async () => {
    const instance = app();

    expect((await instance.request('/x')).status).toBe(200);
    expect((await instance.request('/x')).status).toBe(200);

    const blocked = await instance.request('/x');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('counts each key separately', async () => {
    const instance = new Hono();
    let key = 'a';
    instance.use('*', rateLimit({ limit: 1, windowMs: 60_000, key: () => key }));
    instance.get('/x', (c) => c.text('ok'));

    expect((await instance.request('/x')).status).toBe(200);
    expect((await instance.request('/x')).status).toBe(429);

    key = 'b';
    expect((await instance.request('/x')).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
npx vitest run --project server
```

Expected: FAIL — cannot resolve `./rateLimit.ts`, and `/me` returns 404.

- [ ] **Step 4: Implement the origin guard**

Create `server/src/middleware/origin.ts`:

```ts
import type { MiddlewareHandler } from 'hono';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie authentication.
 *
 * A `SameSite=Lax` cookie is not sent on a cross-site `fetch`, which already
 * blocks the classic attack — but Lax IS sent on a cross-site top-level
 * navigation, and this service is same-site with the app, so a second check
 * belongs here rather than being assumed away.
 *
 * Safe methods are exempt: a top-level GET carries no `Origin` in some
 * browsers, and guarding it would break the app rather than protect it.
 */
export function originGuard(allowed: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE.has(c.req.method)) return next();

    const origin = c.req.header('origin');
    if (origin === undefined || !allowed.includes(origin)) {
      return c.json({ error: 'origin not allowed' }, 403);
    }
    return next();
  };
}
```

- [ ] **Step 5: Implement the rate limiter**

Create `server/src/middleware/rateLimit.ts`:

```ts
import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key: (c: Context) => string;
}

/**
 * A fixed-window counter held in memory.
 *
 * In memory because the service is a single process behind one tunnel; a Redis
 * dependency would buy nothing until there is a second instance. **If a second
 * instance ever appears, this becomes per-instance and the effective limit
 * multiplies** — which is why the state is deliberately trivial to relocate.
 *
 * Open signup is what makes this a day-one requirement rather than later
 * hardening: without it one script fills the Mini's disk.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const now = Date.now();
    const key = options.key(c);
    const current = windows.get(key);

    if (current === undefined || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.limit) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      c.header('retry-after', String(retryAfter));
      return c.json({ error: 'too many requests' }, 429);
    }

    current.count += 1;
    return next();
  };
}

/** The client IP as Cloudflare reports it, falling back to the socket. */
export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
}
```

- [ ] **Step 6: Implement the account routes**

Create `server/src/routes/account.ts`:

```ts
import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { clearedSessionCookie, readCookie, SESSION_COOKIE } from '../auth/cookies.ts';
import { findSession } from '../repositories/sessions.ts';
import { deleteUser } from '../repositories/users.ts';

interface EmailRow {
  email: string | null;
}

export function accountRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  async function authenticate(cookieHeader: string | undefined): Promise<string | null> {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    if (token === null) return null;
    return findSession(deps.query, token);
  }

  app.get('/me', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    const rows = (await deps.query(
      'SELECT email FROM identities WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
      [userId],
    )) as EmailRow[];

    return c.json({ userId, email: rows[0]?.email ?? null });
  });

  app.delete('/account', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    // One delete: identities and sessions cascade. D2's tables must cascade
    // too rather than being added to a list here.
    await deleteUser(deps.query, userId);

    c.header('set-cookie', clearedSessionCookie(deps.secureCookies));
    return c.body(null, 204);
  });

  return app;
}
```

- [ ] **Step 7: Wire everything into the app**

Replace the body of `createApp` in `server/src/app.ts`:

```ts
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('*', originGuard([deps.env.appOrigin]));

  // Auth is limited by IP, because an unauthenticated caller has no user id to
  // limit by — and the login endpoints are the ones reachable without a session.
  app.use(
    '/auth/*',
    rateLimit({ limit: 20, windowMs: 60_000, key: clientIp }),
  );
  app.use(
    '*',
    rateLimit({ limit: 300, windowMs: 60_000, key: clientIp }),
  );

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', authRoutes(deps));
  app.route('/', accountRoutes(deps));

  return app;
}
```

with these imports added:

```ts
import { accountRoutes } from './routes/account.ts';
import { originGuard } from './middleware/origin.ts';
import { clientIp, rateLimit } from './middleware/rateLimit.ts';
```

- [ ] **Step 8: Add CORS so the app can call the API**

The app is on a different **origin** even though it is the same **site**, so the
browser requires CORS headers on top of the cookie. Add to `createApp`,
immediately after the `originGuard` line:

```ts
  // Same-site, different origin: the cookie is sent, but the response is only
  // readable with these headers. `credentials` is what makes the cookie count.
  app.use('*', async (c, next) => {
    await next();
    c.header('access-control-allow-origin', deps.env.appOrigin);
    c.header('access-control-allow-credentials', 'true');
  });

  app.options('*', (c) => {
    c.header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    c.header('access-control-allow-headers', 'content-type');
    return c.body(null, 204);
  });
```

- [ ] **Step 9: Run everything**

```bash
npx vitest run --project server
npm run typecheck
npm run lint
npx vitest run scripts/serverBoundaries.test.ts
```

Expected: all PASS.

- [ ] **Step 10: Prove the origin guard is load-bearing**

Change `originGuard([deps.env.appOrigin])` to `originGuard(['*'])` temporarily
— note this makes the allowlist match nothing, so instead delete the
`app.use('*', originGuard(...))` line entirely:

```bash
npx vitest run --project server
```

Expected: FAIL on "refuses a mutating request from a foreign origin". Restore
the line and re-run to green.

- [ ] **Step 11: Commit**

```bash
git add server/src/middleware server/src/routes server/src/app.ts
git commit -m "feat(server): /me, DELETE /account, CSRF guard, rate limiting

Rate limiting is day-one rather than later hardening because signup is
open: without it one script fills the Mini's disk. The window is held in
memory, which is correct for a single process behind one tunnel and
documented as multiplying if a second instance ever appears.

The origin guard exempts safe methods deliberately — a top-level GET
carries no Origin in some browsers, so guarding it would break the app
rather than protect it.

DELETE /account is one statement because identities and sessions
cascade. D2's tables must cascade too rather than extending a list here:
a forgotten line in such a list is data outliving the account that owned
it."
```

---

### Task 9: The client session hook

Nothing renders yet. This task is the API client and the state machine, tested
in isolation, so the UI task has nothing to debug but layout.

**Files:**

- Create: `src/features/account/config.ts`
- Create: `src/features/account/api.ts`
- Create: `src/features/account/useSession.ts`
- Test: `src/features/account/useSession.test.tsx`

**Interfaces:**

- Consumes: `GET /me`, `POST /auth/logout`, `DELETE /account` (Tasks 7–8).
- Produces:
  - `API_ORIGIN: string`
  - `interface Account { userId: string; email: string | null }`
  - `type SessionState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; account: Account } | { status: 'unavailable' }`
  - `useSession(): { state: SessionState; signIn: () => void; signOut: () => Promise<void>; deleteAccount: () => Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `src/features/account/useSession.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSession } from './useSession';

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) =>
      handler(String(input), init),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSession', () => {
  it('starts loading and never blocks the caller', () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    const { result } = renderHook(() => useSession());

    // The first render must return synchronously with no awaited network call:
    // the app's boot guarantee is that nothing here can delay paint.
    expect(result.current.state.status).toBe('loading');
  });

  it('resolves to signedIn with the account', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ userId: 'u1', email: 'a@example.com' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
    expect(result.current.state).toEqual({
      status: 'signedIn',
      account: { userId: 'u1', email: 'a@example.com' },
    });
  });

  it('resolves to signedOut on 401', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.state.status).toBe('signedOut'));
  });

  it('resolves to unavailable when the server cannot be reached', async () => {
    // The normal state for a machine that sleeps. It must be distinct from
    // signedOut, because telling a signed-in user they are signed out whenever
    // the Mini naps is a lie the UI would then repeat.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('sends credentials on every call', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));

    renderHook(() => useSession());

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('returns to signedOut after signOut', async () => {
    mockFetch((url) =>
      url.endsWith('/me')
        ? new Response(JSON.stringify({ userId: 'u1', email: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 200 }),
    );

    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.state.status).toBe('signedOut');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/features/account
```

Expected: FAIL — cannot resolve `./useSession`.

- [ ] **Step 3: Write the config**

Create `src/features/account/config.ts`:

```ts
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
```

- [ ] **Step 4: Write the API client**

Create `src/features/account/api.ts`:

```ts
import { API_ORIGIN } from './config';

export interface Account {
  userId: string;
  email: string | null;
}

/** Thrown when the server could not be reached at all, as opposed to refusing. */
export class ServerUnavailableError extends Error {}

/**
 * The one place `credentials: 'include'` is written.
 *
 * Without it the browser sends no cookie and every call is anonymous — a
 * failure that looks exactly like being signed out, which is the hardest kind
 * to diagnose.
 */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_ORIGIN}${path}`, { ...init, credentials: 'include' });
  } catch (cause) {
    throw new ServerUnavailableError(`cannot reach ${API_ORIGIN}`, { cause });
  }
}

/** The current account, or null when the server says nobody is signed in. */
export async function fetchAccount(): Promise<Account | null> {
  const response = await call('/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new ServerUnavailableError(`/me returned ${response.status}`);
  return (await response.json()) as Account;
}

export async function postLogout(): Promise<void> {
  await call('/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
}

export async function deleteAccount(): Promise<void> {
  const response = await call('/account', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok && response.status !== 204) {
    throw new ServerUnavailableError(`/account returned ${response.status}`);
  }
}

/** Full-page navigation, because an OAuth redirect cannot happen in `fetch`. */
export function startGoogleSignIn(): void {
  window.location.assign(`${API_ORIGIN}/auth/google`);
}
```

- [ ] **Step 5: Write the hook**

Create `src/features/account/useSession.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

import {
  type Account,
  deleteAccount as deleteAccountRequest,
  fetchAccount,
  postLogout,
  startGoogleSignIn,
} from './api';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; account: Account }
  | { status: 'unavailable' };

export interface Session {
  state: SessionState;
  signIn: () => void;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

/**
 * Session state, resolved after mount.
 *
 * The fetch lives in an effect and the initial state is `loading`, so the first
 * render is synchronous and the app's boot guarantee holds: nothing here can
 * delay paint, and a Mini that never answers leaves the app fully usable.
 *
 * `unavailable` is deliberately distinct from `signedOut`. For a machine that
 * sleeps, unreachable is the NORMAL case, and telling a signed-in user they are
 * signed out every time it naps would be a lie the UI then repeats back.
 */
export function useSession(): Session {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const account = await fetchAccount();
        if (cancelled) return;
        setState(account === null ? { status: 'signedOut' } : { status: 'signedIn', account });
      } catch {
        if (!cancelled) setState({ status: 'unavailable' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await postLogout();
    } catch {
      // The cookie may already be gone, or the server may be asleep. Either
      // way the local intent is "signed out", and refusing to reflect that
      // would strand the user in a state they explicitly left.
    }
    setState({ status: 'signedOut' });
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountRequest();
    setState({ status: 'signedOut' });
  }, []);

  return { state, signIn: startGoogleSignIn, signOut, deleteAccount };
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/features/account
npm run typecheck
```

Expected: PASS, six tests.

- [ ] **Step 7: Commit**

```bash
git add src/features/account
git commit -m "feat(account): session state resolved after mount

The fetch lives in an effect with an initial loading state, so the first
render is synchronous and the app's boot guarantee holds: nothing here
can delay paint, and a Mini that never answers leaves the app usable.

unavailable is deliberately a distinct state from signedOut. For a
machine that sleeps, unreachable is the normal case, and telling a
signed-in user they are signed out every time it naps is a lie the UI
would then repeat.

credentials: 'include' is written in exactly one place — omitting it
makes every call anonymous, which looks identical to being signed out."
```

---

### Task 10: The account menu

The sidebar footer already holds `<ThemePicker />` in a flex row
(`AppShell.tsx:244-246`). The account control joins it there.

**Files:**

- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ko.ts`
- Create: `src/features/account/AccountMenu.tsx`
- Create: `src/features/account/index.ts`
- Modify: `src/app/AppShell.tsx`
- Test: `src/features/account/AccountMenu.test.tsx`

**Interfaces:**

- Consumes: `useSession` (Task 9), `Popover` (`src/ui/Popover.tsx`), `Icon`
  (`src/ui/Icon.tsx`), `useT` (`src/i18n`).
- Produces: `<AccountMenu />`, exported from `src/features/account/index.ts`.

- [ ] **Step 1: Add the translations**

In `src/i18n/en.ts`, add before the closing brace:

```ts
  'account.menu': 'Account',
  'account.signedOut': 'Not signed in',
  'account.signIn.google': 'Sign in with Google',
  'account.signOut': 'Sign out',
  'account.unavailable': 'Sync server unreachable',
  'account.unavailable.body': 'Your notes are safe on this device. Sync resumes automatically.',
  // Stated plainly because it is the honest consequence of the ruling that
  // logout does not clear this device: on a shared browser the next person can
  // read these notes. Disclosure is the mitigation.
  'account.signOut.note': 'Your notes stay on this device.',
```

In `src/i18n/ko.ts`, add the same keys:

```ts
  'account.menu': '계정',
  'account.signedOut': '로그인하지 않음',
  'account.signIn.google': 'Google로 로그인',
  'account.signOut': '로그아웃',
  'account.unavailable': '동기화 서버에 연결할 수 없음',
  'account.unavailable.body': '메모는 이 기기에 안전하게 있습니다. 동기화는 자동으로 다시 시작됩니다.',
  'account.signOut.note': '메모는 이 기기에 그대로 남습니다.',
```

- [ ] **Step 2: Write the failing test**

Create `src/features/account/AccountMenu.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestI18nProvider } from '@/i18n/testing';

import { AccountMenu } from './AccountMenu';

function mount(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => handler(String(input))));
  return render(
    <TestI18nProvider>
      <AccountMenu />
    </TestI18nProvider>,
  );
}

const signedIn = () =>
  new Response(JSON.stringify({ userId: 'u1', email: 'a@example.com' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountMenu', () => {
  it('offers Google sign-in when signed out', async () => {
    mount(() => new Response('{}', { status: 401 }));

    await userEvent.click(await screen.findByRole('button', { name: /account/i }));

    expect(screen.getByRole('menuitem', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('shows the signed-in address and a sign-out row', async () => {
    mount(signedIn);

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('discloses that notes stay on the device', async () => {
    // Required by the spec, not decoration: the ruling that logout leaves
    // notes behind is only defensible if the user is told.
    mount(signedIn);

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    expect(screen.getByText(/stay on this device/i)).toBeInTheDocument();
  });

  it('says the server is unreachable rather than claiming signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(
      <TestI18nProvider>
        <AccountMenu />
      </TestI18nProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /account/i }));

    expect(screen.getByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
  });

  it('is announced as a menu trigger', async () => {
    mount(() => new Response('{}', { status: 401 }));

    const trigger = await screen.findByRole('button', { name: /account/i });

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/features/account
```

Expected: FAIL — cannot resolve `./AccountMenu`.

- [ ] **Step 4: Check the icon and i18n test helpers exist as used**

```bash
grep -n "export" src/i18n/testing.tsx
grep -n "UserRound\|CircleUser\|LogIn" src/ui/Icon.tsx
```

If the icon names are absent, add the ones you need to `src/ui/Icon.tsx` — it
is the **only** file permitted to import `lucide-react`, and
`scripts/sourceLint.test.ts` enforces that. If `TestI18nProvider` is named
differently, use the actual export in the test above.

- [ ] **Step 5: Write the component**

Create `src/features/account/AccountMenu.tsx`:

```tsx
import { type ReactElement, useState } from 'react';

import { useT } from '@/i18n';
import { Icon, UserRound } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import { useSession } from './useSession';

/**
 * The sidebar footer's account control, beside the theme picker.
 *
 * Deliberately a sibling of `ThemePicker` rather than a new chrome region: both
 * are app-level settings reached rarely, and the footer already exists with the
 * right affordance.
 *
 * No colour is written here. Every value is a token utility, so a palette edit
 * updates this menu for free.
 */
export function AccountMenu(): ReactElement {
  const t = useT();
  const { state, signIn, signOut } = useSession();
  const [open, setOpen] = useState(false);

  function row(label: string, onClick: () => void): ReactElement {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClick();
          setOpen(false);
        }}
        className="text-ui ease-bear text-text hover:bg-hover flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-[var(--bear-duration-fast)]"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }

  function body(): ReactElement {
    if (state.status === 'loading') {
      return <p className="text-ui text-muted px-2 py-1">{t('account.menu')}</p>;
    }

    if (state.status === 'unavailable') {
      return (
        <div className="px-2 py-1">
          <p className="text-ui text-text">{t('account.unavailable')}</p>
          <p className="text-ui text-muted mt-1">{t('account.unavailable.body')}</p>
        </div>
      );
    }

    if (state.status === 'signedOut') {
      return (
        <>
          <p className="text-ui text-muted px-2 py-1">{t('account.signedOut')}</p>
          {row(t('account.signIn.google'), signIn)}
        </>
      );
    }

    return (
      <>
        <p className="text-ui text-muted truncate px-2 py-1">
          {state.account.email ?? state.account.userId}
        </p>
        {row(t('account.signOut'), () => void signOut())}
        <p className="text-ui text-faint px-2 py-1">{t('account.signOut.note')}</p>
      </>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account.menu')}
        onClick={() => setOpen((previous) => !previous)}
        className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon of={UserRound} />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('account.menu')}
        className="bottom-full left-0 mb-1 w-64"
      >
        {body()}
      </Popover>
    </div>
  );
}
```

**Note on the two class strings above:** match the exact utility names used by
`ThemePicker.tsx`. If `Icon` takes its glyph through a different prop than `of`,
or `Popover` requires different props, follow the real signatures — the point is
the structure, not these literals.

- [ ] **Step 6: Export the feature**

Create `src/features/account/index.ts`:

```ts
export { AccountMenu } from './AccountMenu';
export { useSession } from './useSession';
export type { Account, SessionState } from './useSession';
```

`Account` is re-exported from `useSession.ts`; add
`export type { Account } from './api';` there if it is not already re-exported.

- [ ] **Step 7: Mount it in the shell**

In `src/app/AppShell.tsx`, add the import beside the existing appearance import:

```ts
import { AccountMenu } from '@/features/account';
```

and change the footer:

```tsx
        <div className="border-border flex shrink-0 items-center gap-1 border-t p-1">
          <ThemePicker />
          <AccountMenu />
        </div>
```

- [ ] **Step 8: Run the whole suite**

```bash
npx vitest run
npm run typecheck
npm run lint
npm run format
```

Expected: all PASS. A missing `ko.ts` key is a **compile error** — add the
translation, never weaken the `Record<TranslationKey, string>` annotation.

- [ ] **Step 9: Verify it visually, not only by test**

Passing tests are not evidence the screen is right — the unit suite has no
layout engine.

```bash
docker compose -f server/docker-compose.yml up -d
npm run server:migrate
npm run server:dev &
npm run dev
```

Open the app, click the account button, and confirm: the popover opens above the
footer without clipping, the sign-in row is legible in **light and dark themes**,
and a long email truncates rather than widening the menu. Stop the Mini's
container and confirm the menu reads "unreachable" rather than "not signed in".

- [ ] **Step 10: Commit**

```bash
git add src/i18n/en.ts src/i18n/ko.ts src/features/account src/app/AppShell.tsx
git commit -m "feat(account): the sidebar account menu

A sibling of ThemePicker in the existing footer rather than a new chrome
region: both are rarely-reached app-level settings.

The unreachable state says the server cannot be reached instead of
claiming the user is signed out — for a machine that sleeps, unreachable
is the normal case. And the signed-in view states plainly that notes stay
on this device, which is what makes the ruling that logout does not clear
IndexedDB defensible rather than a surprise.

Verified in the running app in both themes, not only by test: the unit
suite has no layout engine."
```

---

### Task 11: Deploy, and write down what bit us

The last task. It ends with a real Google sign-in working against
`api.markflowing.com`, and with the surprises recorded where the next session
will read them.

**Files:**

- Modify: `CLAUDE.md`
- Create: `server/README.md`

**Interfaces:**

- Consumes: everything.
- Produces: a deployed service and updated documentation.

- [ ] **Step 1: Human step — register the production OAuth client**

In Google Cloud Console → Credentials → OAuth client ID → Web application:

- Authorized JavaScript origin: `https://markflowing.com`
- Authorized redirect URI: `https://api.markflowing.com/auth/google/callback`

The redirect URI must match **character for character**, trailing slash
included. Put the values in `server/.env` on the Mini — never in git, never in
a commit message, never in this file.

- [ ] **Step 2: Human step — add the tunnel route**

Add a route to a Cloudflare tunnel on the Mini: `api.markflowing.com` →
`http://localhost:8787`. Follow the existing `lunch-api` / `docs-api` pattern.

- [ ] **Step 3: Bring the service up on the Mini**

```bash
docker compose -f server/docker-compose.yml up -d
npm run server:migrate
npm run server:dev
```

Then verify from **outside** the LAN, which is the only test that proves the
tunnel and TLS:

```bash
curl -sS https://api.markflowing.com/health
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Sign in for real**

Open `https://markflowing.com`, click the account button, sign in with Google.
Confirm: you land back on the app signed in, and the menu shows your address.

Then confirm the cookie is scoped as designed — in DevTools → Application →
Cookies, `mf_session` must be listed under `api.markflowing.com` with
`HttpOnly` ✓, `Secure` ✓, and **no Domain of `.markflowing.com`**. A Domain
there means the cookie is being sent to `lunch-api` and `docs-api` too, and the
`Domain` attribute must be removed before this ships.

- [ ] **Step 5: Update `CLAUDE.md`**

Change the status table's D row:

```markdown
| D1 server: hosting, accounts, Google login | complete  |
| D2 server: the sync protocol               | queued    |
```

Add to **Architecture boundaries**:

```markdown
- `server/` is a fifth tsconfig project and may import **only**
  `src/data/types.ts` from under `src/` — never `src/features/`, `src/ui/`,
  `src/app/` or `src/i18n/`. Enforced by `scripts/serverBoundaries.test.ts`,
  which also holds the **multi-tenancy guard**: every SQL statement naming a
  user-scoped table must constrain `user_id` or carry an explicit
  `/* tenancy-ok: reason */`. One forgotten `WHERE` is a cross-user notes leak,
  which is not a class of bug to catch by review.
```

Add to **Toolchain surprises**, using the real text of whatever actually bit
you — at minimum these, which are known before you start:

```markdown
- **Vitest runs two projects now, and the server project deliberately does not
  `extend` the root config.** `vitest.setup.ts` installs jsdom and swaps the
  global `Blob` for Node's; inheriting that in server tests would make them
  lie about the environment they prove. A test asserts `document` is absent so
  the split cannot silently collapse. Consequence: `npx vitest run` with no
  `--project` runs both, and a server test accidentally placed under `src/`
  runs in jsdom without complaint.
- **The database integration tests skip when `TEST_DATABASE_URL` is unset**,
  which locally is convenient and in CI would be a green suite that ran
  nothing. `server/src/db/migrate.test.ts` asserts the variable is present
  whenever `CI` is set, so removing it from `ci.yml` fails loudly instead.
- **A `Domain=` attribute on the session cookie is a cross-project leak, not a
  convenience.** `lunch-api.markflowing.com` and `docs-api.markflowing.com`
  are unrelated projects on the same registrable domain, so the cookie is
  host-only on `api.markflowing.com`. Nothing in the test suite can see a
  wrongly-scoped cookie in a real browser — check DevTools.
- **`SameSite=Strict` silently breaks OAuth.** Strict is dropped on the
  redirect back from Google, so the user lands on the app still signed out with
  no error anywhere. Both cookies are `Lax` for this reason.
```

- [ ] **Step 6: Write the server README**

Create `server/README.md`:

```markdown
# server

The sync API behind `api.markflowing.com`. A Hono service on Node, plain SQL
against its own MariaDB container.

D1 ships accounts only: **no note data crosses the network yet.**

## Run it

    cp .env.example .env        # then fill in the Google credentials
    docker compose up -d
    npm run server:migrate
    npm run server:dev

`.env` is gitignored and must stay so.

## Layout

| Path | What it is |
| --- | --- |
| `src/app.ts` | Builds the Hono app from injected deps. Does not listen, so tests need no port |
| `src/env.ts` | Validates the whole environment at boot, naming any missing key |
| `src/auth/` | PKCE, the Google provider, cookies, the two OAuth routes |
| `src/repositories/` | Users, identities, sessions. Plain SQL |
| `src/db/` | The pool and the migration runner |
| `migrations/` | Numbered `.sql`, applied in name order |

## Things that will bite you

- **The redirect URI is on THIS host**, not the app's:
  `https://api.markflowing.com/auth/google/callback`. That is what keeps the
  client secret server-side.
- **The session cookie carries no `Domain`.** Host-only scoping is what keeps
  it off `lunch-api` and `docs-api`, unrelated projects on the same domain.
- **Both cookies are `SameSite=Lax`, never `Strict`.** Strict is dropped on the
  redirect back from Google, and the failure is silent.
- **Identities are never linked by email.** Signing in with a second provider
  creates a second account until you link it from inside a session. This is
  deliberate; see the spec.
- **Rate limiting is in memory.** Correct for one process behind one tunnel. A
  second instance makes the limit per-instance, so the effective limit
  multiplies.
- **Integration tests need `TEST_DATABASE_URL`** or they skip.
```

- [ ] **Step 7: Run every gate**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run test:e2e
```

All six must pass. **Check exit codes, not pass counts.**

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md server/README.md
git commit -m "docs: record D1's status, boundary, and toolchain surprises

The server boundary and the multi-tenancy guard go in Architecture
boundaries because they are enforced by tests, not by prose. The four
toolchain surprises are the ones that cost real time and that no source
grep can see: the deliberate absence of extend in the server Vitest
project, the skip condition on the database tests, and the two cookie
attributes whose wrong values fail silently in a real browser and are
invisible to every test."
```

---

## Self-Review

**Spec coverage.** Every D1 requirement maps to a task:

| Spec requirement | Task |
| --- | --- |
| Apex hosting, `base: '/'`, CNAME, SSL-mode warning | 1 |
| `server/` as a fifth tsconfig project | 2 |
| Node/TS server, no ORM | 2, 4 |
| `server/` imports only `src/data/types.ts` | 3 |
| Multi-tenancy guard test | 3 |
| Own MariaDB container and volume | 4 |
| `users` / `identities` / `sessions` schema | 4 |
| `users.rev_counter` created for D2 | 4 |
| Real-MariaDB integration tests | 4 |
| Identity separate from user from day one | 4, 5 |
| **No email-based auto-linking** | 5 |
| Opaque revocable session, not a JWT | 6 |
| `HttpOnly; Secure; SameSite=Lax`, host-only, 30-day rolling | 6 |
| Authorization Code + PKCE, redirect URI on the API host | 7 |
| `state` anti-forgery | 7 |
| Provider secrets server-side only | 2, 7, 11 |
| CSRF: `Origin` allowlist + non-simple content type | 8 |
| Rate limits | 8 |
| `DELETE /account` | 8 |
| Boot order: never on the render path | 9 |
| "Offline is normal" as a distinct state | 9, 10 |
| Logout leaves notes, **with disclosure** | 10 |
| Every string through `useT`, `ko.ts` complete | 10 |
| No colour outside `tokens.css` | 10 |
| Stub-provider auth tests | 7 |
| Port-4173 hygiene | 1, 11 |

**Deferred to D2, and listed in D1's "Not in D1" so it cannot be lost:** the
per-user quota. It is a byte cap on note text and there is no note text on the
server in D1.

**Not covered by any task, deliberately:** the guest-note adoption dialog and
the sync status indicator — both D2, both listed above.

**Type consistency.** `Query` is defined in Task 2 and used unchanged in 4, 5,
6, 7, 8. `AppDeps` is widened once, in Task 7, and Task 7 Step 10 updates the
one existing call site in `app.test.ts`. `Claims` is defined in Task 5 and
imported by `google.ts` in Task 7. `Account` and `SessionState` are defined in
Task 9 and consumed in Task 10. `createPool` is stubbed in Task 2 Step 9 and
replaced in Task 4 Step 5, so the project typechecks at every commit boundary.

**Known soft spots, flagged rather than hidden.** Task 10's Tailwind utility
strings and the `Icon`/`Popover` prop names are written from `ThemePicker.tsx`'s
pattern; Step 4 of that task tells the implementer to check the real signatures
first, because a wrong prop name there is a compile error, not a silent bug.
