# G — PDF export, rendered server-side: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser print-dialog PDF pipeline with a server-rendered PDF that matches the app exactly, requires a signed-in account, and costs zero client bundle.

**Architecture:** The client keeps building the export document with the existing `renderNoteHtml`, POSTs that HTML to an authenticated Hono route, which forwards it to a Chromium renderer running in its own container beside MariaDB and streams the PDF back. The `server/` → `src/` import boundary makes this seam mandatory, not merely tidy: the server may import only `src/data/types.ts` and therefore cannot render a note itself.

**Tech Stack:** Playwright Chromium (container only — never bundled), Hono on Node, Docker Compose, React 19 + Tailwind v4, Vitest, Playwright test.

**Spec:** `docs/superpowers/specs/2026-08-25-g-pdf-export-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **All six gates must pass before any commit:** `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`, `npm run build`, `npm run test:e2e`.
- **Before any e2e run, and always before a fault injection:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview server on 4173 is silently reused and the suite then tests an old build.
- **Before running `npm run server:dev:local`:** `npm run server:service:stop`. The launchd job's `KeepAlive` is unconditional, so killing the port is not enough.
- **No user-facing string is hardcoded.** Everything goes through `useT`; `src/i18n/en.ts` defines the key type and `ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error. Never weaken that annotation.
- **Every colour comes from a CSS custom property.** Literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **`server/` may import only `src/data/types.ts`** from under `src/`. Enforced by `scripts/serverBoundaries.test.ts`.
- **Every SQL statement naming a user-scoped table must constrain `user_id`** in a predicate position, or carry `/* tenancy-ok: reason */` on its own line or exactly one line above. G adds no SQL, so this should not come up — if a task finds itself writing SQL, stop and re-read the spec.
- **`erasableSyntaxOnly`** forbids `enum`, parameter properties and namespaces. **`verbatimModuleSyntax`** requires `import type` / `export type`.
- **No backtick may appear inside `renderNoteHtml`'s template literal** in `src/features/export/html.ts`. One terminates it and the error points at the prose, not the backtick. This has now happened twice.
- **Server imports use explicit `.ts` extensions** (`from './app.ts'`). Client imports do not. Follow the file you are in.
- **`instanceof Blob` / `instanceof ArrayBuffer` are false under Vitest** — `vitest.setup.ts` swaps the global `Blob` for Node's. Duck-type in tests, never `instanceof`.
- **Check exit codes, not pass counts,** when reviewing editor tests: an unstubbed jsdom error is uncaught and exits 1 even when every assertion passed.
- **Rulings to read before touching their triggers**, not after: `docs/rulings/export.md` (Tasks 5, 6, 7), `docs/rulings/accessibility.md` (Task 6), `docs/rulings/testing-and-tooling.md` (Task 7), `docs/rulings/design-tokens-and-layout.md` (Task 7).

---

## File Structure

**New — the renderer service** (its own npm workspace-free directory; it is not part of any tsconfig project under `src/` or `server/src/`):

- `server/pdf/render.ts` — the Chromium wrapper. One exported function; all five security controls live here.
- `server/pdf/server.ts` — a ~40-line HTTP listener exposing `POST /render` and `GET /health`.
- `server/pdf/queue.ts` — bounded concurrency (max 2) and the browser-restart counter.
- `server/pdf/render.test.ts` — SSRF, JS denial, timeout, Pretendard subset.
- `server/docker/pdf/Dockerfile` — Playwright base image plus fonts.

**New — the API seam:**

- `server/src/http/body.ts` — `readCappedBody`, extracted from `routes/sync.ts` because `/export/pdf` is its second consumer.
- `server/src/routes/export.ts` — the authenticated pass-through.
- `server/src/routes/export.test.ts`

**New — the client seam:**

- `src/features/export/requestPdf.ts` — the transport, and the status→error mapping.
- `src/features/export/requestPdf.test.ts`
- `src/features/account/SessionContext.tsx` — the lifted provider.
- `src/features/account/SessionContext.test.tsx`

**Deleted:**

- `src/features/export/print.ts`, `src/features/export/print.test.ts`

**Modified:** `src/features/export/exportNote.ts`, `ExportMenu.tsx`, `filename.ts`, `html.ts`, `html.test.ts`, `index.ts`; `src/features/account/AccountMenu.tsx`, `index.ts`; `src/app/AppShell.tsx`; `src/i18n/en.ts`, `ko.ts`; `server/src/app.ts`, `env.ts`, `routes/sync.ts`; `server/docker-compose.yml`, `server/README.md`, `server/.env`, `server/.env.local`; `e2e/notes.spec.ts`; `package.json`; `docs/rulings/export.md`; `CLAUDE.md`; `docs/superpowers/NEXT.md`.

---

## Task 1: Prove the renderer runs natively on this machine

The spec names two risks that invalidate the whole approach if they land wrong. This task answers them and writes nothing to `src/`. **If either answer is bad, stop and report — do not proceed to Task 2.**

**Files:**
- Create: `.superpowers/sdd/2026-08-25-g-pdf-export/task-1-measurements.md` (ledger only, gitignored)

**Interfaces:**
- Consumes: nothing.
- Produces: the pinned Playwright image tag every later task uses, recorded verbatim.

- [ ] **Step 1: Confirm the host architecture**

```bash
uname -m          # expect arm64
docker version --format '{{.Server.Arch}}'
```

- [ ] **Step 2: Confirm the Playwright image has a native arm64 variant**

Pick the tag matching the installed Playwright, then inspect the manifest **without pulling**:

```bash
node -e "console.log(require('@playwright/test/package.json').version)"
docker manifest inspect mcr.microsoft.com/playwright:v<VERSION>-noble \
  | grep -A2 '"architecture"'
```

Expected: an entry with `"architecture": "arm64"` and `"os": "linux"`.

**If arm64 is absent, STOP.** Renders would run under QEMU emulation and the spec's calculus does not survive that. Report it and await a decision.

- [ ] **Step 3: Pull it and measure the disk cost**

```bash
docker pull mcr.microsoft.com/playwright:v<VERSION>-noble
docker image inspect mcr.microsoft.com/playwright:v<VERSION>-noble --format '{{.Size}}'
df -h /
```

- [ ] **Step 4: Measure a real render end to end**

```bash
docker run --rm -v "$PWD:/w" -w /w mcr.microsoft.com/playwright:v<VERSION>-noble \
  node -e "
    const { chromium } = require('playwright');
    (async () => {
      const t0 = Date.now();
      const b = await chromium.launch();
      const t1 = Date.now();
      const ctx = await b.newContext({ javaScriptEnabled: false });
      const p = await ctx.newPage();
      await p.setContent('<h1>안녕하세요</h1><pre>const x = 1;</pre>');
      await p.emulateMedia({ media: 'screen' });
      const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
      console.log('launch_ms', t1 - t0, 'render_ms', Date.now() - t1, 'bytes', pdf.length);
      await b.close();
    })();
  "
```

- [ ] **Step 5: Record the numbers and the pinned tag in the ledger**

Write launch ms, render ms, PDF bytes, image bytes, and the exact image tag. Later tasks reference this tag; **do not** use a floating tag.

- [ ] **Step 6: Report, do not commit**

Nothing here is committed — the measurements live in the gitignored ledger. Report the four numbers and whether arm64 was native.

---

## Task 2: Lift session state so more than one feature can read it

`useSession()` is called in exactly one place — `AccountMenu.tsx:30` — and performs its own `GET /me` on mount with no sharing or caching. Calling it a second time from the export path would issue a second boot request. This task lifts it into a provider so both features read one session, and changes no behaviour.

**Files:**
- Create: `src/features/account/SessionContext.tsx`, `src/features/account/SessionContext.test.tsx`
- Modify: `src/features/account/AccountMenu.tsx`, `src/features/account/index.ts`, `src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `useSession(): Session`, `SessionState` from `./useSession`.
- Produces:
  - `SessionProvider({ children }: { children: ReactNode }): ReactElement`
  - `useSessionValue(): Session` — throws outside a provider.
  - Both re-exported from `src/features/account/index.ts`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/account/SessionContext.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionProvider, useSessionValue } from './SessionContext';

function Probe(): React.ReactElement {
  return <span data-testid="status">{useSessionValue().state.status}</span>;
}

describe('SessionContext', () => {
  it('exposes the session to a descendant', () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    // `loading` is the synchronous first render — the boot guarantee.
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
  });

  it('throws outside a provider rather than yielding a silent default', () => {
    // A default value would make a misplaced consumer render "signed out"
    // forever, which looks like a product decision instead of a wiring bug.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/SessionProvider/);
    quiet.mockRestore();
  });

  it('calls useSession exactly once for two consumers', () => {
    // The whole point of the lift: two readers, one GET /me.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <SessionProvider>
        <Probe />
        <Probe />
      </SessionProvider>,
    );

    const meCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/me'));
    expect(meCalls.length).toBeLessThanOrEqual(1);
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/account/SessionContext.test.tsx`
Expected: FAIL — `Cannot find module './SessionContext'`.

- [ ] **Step 3: Write the provider**

```tsx
// src/features/account/SessionContext.tsx
import { createContext, use, type ReactElement, type ReactNode } from 'react';

import { useSession, type Session } from './useSession';

/**
 * One session, read by several features.
 *
 * `useSession` performs its own `GET /me` on mount and shares nothing, so a
 * second caller means a second boot request. Until G there was exactly one
 * caller (`AccountMenu`) and that was invisible; the export menu is the
 * second, and gating PDF on sign-in through a duplicate hook call would have
 * doubled the request the boot gate exists to avoid.
 *
 * `null` rather than a default session object: a default would make a
 * consumer mounted outside the provider render "signed out" forever, which
 * reads as a product decision rather than the wiring bug it is.
 */
const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  return <SessionCtx value={useSession()}>{children}</SessionCtx>;
}

export function useSessionValue(): Session {
  const value = use(SessionCtx);
  if (value === null) throw new Error('useSessionValue requires a SessionProvider above it');
  return value;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/features/account/SessionContext.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Move `AccountMenu` onto the context**

In `AccountMenu.tsx`, replace `const { state, signIn, signOut } = useSession();` with `useSessionValue()`, and drop the now-unused `useSession` import. Export both new symbols from `src/features/account/index.ts` alongside the existing `useSession` export.

- [ ] **Step 6: Wrap the app**

In `src/app/AppShell.tsx`, wrap the rendered tree in `<SessionProvider>`. It must sit **above** whatever renders `AccountMenu` and above the editor, since Task 6 puts a consumer inside `ExportMenu`.

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/features/account src/app/AppShell.test.tsx`
Expected: PASS. `AccountMenu.test.tsx` will need its render wrapped in `<SessionProvider>` — do that rather than reaching around the context.

- [ ] **Step 8: Fault-inject the "exactly once" guarantee**

Temporarily make `SessionProvider` call `useSession()` twice and return the second. Confirm the third test goes red. Restore.

- [ ] **Step 9: Run all six gates, then commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "refactor(account): lift session state into a provider

useSession does its own GET /me with no sharing, so a second caller means a
second boot request. Export needs to read the session to gate PDF; the lift
keeps that to one request instead of two. No behaviour change."
```

---

## Task 3: The renderer service

A standalone Node service, containerised, with every security control the spec names. This is the task whose tests matter most.

**Files:**
- Create: `server/pdf/render.ts`, `server/pdf/queue.ts`, `server/pdf/server.ts`, `server/pdf/render.test.ts`, `server/docker/pdf/Dockerfile`
- Modify: `server/docker-compose.yml`, `vite.config.ts` (a third Vitest project for `server/pdf/`), `package.json`

**Interfaces:**
- Consumes: the image tag pinned in Task 1.
- Produces:
  - `renderPdf(html: string, deps?: RenderDeps): Promise<Uint8Array>`
  - `interface RenderDeps { browser?: Browser; timeoutMs?: number }`
  - `class RenderTimeoutError extends Error`
  - HTTP: `POST /render` (body: raw HTML, `content-type: text/html`) → `application/pdf`; `GET /health` → `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/pdf/render.test.ts
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderPdf, RenderTimeoutError } from './render.ts';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => browser?.close());

describe('renderPdf', () => {
  it('produces a PDF', async () => {
    const pdf = await renderPdf('<h1>hello</h1>', { browser });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('NEVER fetches a subresource, however the HTML asks (SSRF)', async () => {
    // The single most important test here. The renderer is handed arbitrary
    // HTML by an authenticated client and drives a real browser inside the
    // network; one un-aborted request is an internal port scanner.
    const hits: string[] = [];
    const listener: Server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('x');
    });
    await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
    const port = (listener.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    await renderPdf(
      `<img src="${base}/img">
       <link rel="stylesheet" href="${base}/css">
       <iframe src="${base}/frame"></iframe>
       <style>@font-face{font-family:x;src:url(${base}/font)}</style>`,
      { browser },
    );

    await new Promise<void>((r) => listener.close(() => r()));
    expect(hits).toEqual([]);
  });

  it('does not execute script', async () => {
    const pdf = await renderPdf(
      `<title>before</title><script>document.title = 'after'</script>`,
      { browser },
    );
    // The title is PDF metadata; `after` would mean the script ran.
    expect(Buffer.from(pdf).toString('latin1')).not.toContain('after');
  });

  it('times out rather than pinning a worker, and the next render still works', async () => {
    // A CSS-only infinite layout: no script needed, so this survives
    // javaScriptEnabled: false.
    const hostile = '<div style="height:1e9px">x</div>'.repeat(20_000);

    await expect(renderPdf(hostile, { browser, timeoutMs: 500 })).rejects.toBeInstanceOf(
      RenderTimeoutError,
    );

    const after = await renderPdf('<p>still alive</p>', { browser });
    expect(Buffer.from(after.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('embeds a Pretendard subset for Korean', async () => {
    // A text-extraction assertion CANNOT see tofu: a missing glyph still
    // extracts as its codepoint, so a renderer with no Korean face installed
    // would pass. Asserting on the embedded font resources is what actually
    // fails when the image lacks the font.
    const pdf = await renderPdf(
      `<body style="font-family: Pretendard, sans-serif">안녕하세요</body>`,
      { browser },
    );
    expect(Buffer.from(pdf).toString('latin1')).toMatch(/Pretendard/i);
  });
});
```

- [ ] **Step 2: Register a third Vitest project and run the tests to watch them fail**

Add to `vite.config.ts`'s projects array, alongside `app` and `server` — and **do not `extend`**, for the same reason the `server` project does not: `vitest.setup.ts` installs jsdom and swaps the global `Blob`, which would make these tests lie about the environment they prove.

```ts
{
  test: {
    name: 'pdf',
    environment: 'node',
    include: ['server/pdf/**/*.test.ts'],
    testTimeout: 30_000,
  },
},
```

Run: `npx vitest run --project pdf`
Expected: FAIL — `Cannot find module './render.ts'`.

- [ ] **Step 3: Write the renderer**

```ts
// server/pdf/render.ts
import { chromium, type Browser } from 'playwright';

export interface RenderDeps {
  /** Injected so tests share one browser instead of launching per case. */
  browser?: Browser;
  timeoutMs?: number;
}

export class RenderTimeoutError extends Error {
  constructor() {
    super('render timed out');
    this.name = 'RenderTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

let shared: Browser | null = null;

export async function sharedBrowser(): Promise<Browser> {
  shared ??= await chromium.launch();
  return shared;
}

export async function closeSharedBrowser(): Promise<void> {
  await shared?.close();
  shared = null;
}

/**
 * Renders one standalone HTML document to a PDF.
 *
 * Every option here is load-bearing:
 *
 * - `javaScriptEnabled: false` — the export document contains no scripts, so
 *   deny the capability rather than trust the content to lack it.
 * - the route abort — no subresource loads at all. This is the SSRF control:
 *   an img, a link, an iframe or an @font-face url all die here. Fonts come
 *   from the image, so nothing legitimate needs the network.
 * - `setContent`, never `goto` — no client-controlled URL and no file://.
 * - `emulateMedia({ media: 'screen' })` — page.pdf() applies PRINT media by
 *   default, which would re-introduce the editor/export divergence G exists
 *   to remove.
 * - `preferCSSPageSize: true` — the stylesheet's own @page stays the single
 *   source of page geometry rather than a renderer option that can drift.
 *
 * The context is closed in a `finally` so a thrown or timed-out render cannot
 * leak a whole browser context per request.
 */
export async function renderPdf(html: string, deps: RenderDeps = {}): Promise<Uint8Array> {
  const browser = deps.browser ?? (await sharedBrowser());
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = await browser.newContext({ javaScriptEnabled: false });

  try {
    const page = await context.newPage();
    await page.route('**', (route) => route.abort());
    await page.setContent(html, { timeout: timeoutMs, waitUntil: 'load' });
    await page.emulateMedia({ media: 'screen' });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: timeoutMs });
  } catch (error) {
    if (error instanceof Error && /Timeout/i.test(error.message)) throw new RenderTimeoutError();
    throw error;
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run --project pdf`
Expected: PASS, 5 tests.

If the Pretendard test fails locally, that is **correct** — the font is not installed on the host. Note it and let the Dockerfile in Step 7 satisfy it; re-run inside the container in Step 9.

- [ ] **Step 5: Fault-inject the SSRF guard**

Comment out the `page.route('**', ...)` line. Run the suite. Expected: the SSRF test fails with `hits` containing `/img`, `/css`, `/frame` (and possibly `/font`). **This is the injection that proves the whole task.** Restore the line and confirm green.

- [ ] **Step 6: Write the bounded queue**

```ts
// server/pdf/queue.ts
import { closeSharedBrowser } from './render.ts';

/**
 * At most two renders at once, and a browser restart every 50.
 *
 * Chromium's memory grows across renders and the container's `mem_limit` is a
 * kill, not a warning — a bounded queue plus a periodic restart keeps the
 * process well inside it. Two rather than one because a single slot makes one
 * slow render block an unrelated user; more than two on a Mac Mini that also
 * hosts the database buys nothing.
 */
const MAX_CONCURRENT = 2;
const RESTART_EVERY = 50;

let active = 0;
let sinceRestart = 0;
const waiting: (() => void)[] = [];

export async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;

  try {
    return await run();
  } finally {
    active -= 1;
    sinceRestart += 1;

    if (sinceRestart >= RESTART_EVERY && active === 0) {
      sinceRestart = 0;
      await closeSharedBrowser();
    }

    waiting.shift()?.();
  }
}
```

- [ ] **Step 7: Write the HTTP listener and the Dockerfile**

```ts
// server/pdf/server.ts
import { createServer } from 'node:http';

import { withSlot } from './queue.ts';
import { renderPdf, RenderTimeoutError } from './render.ts';

const PORT = Number(process.env.PORT ?? 8788);
const MAX_BYTES = 2 * 1024 * 1024;

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/render') {
    res.writeHead(404).end();
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  req.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_BYTES) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    void (async () => {
      try {
        const pdf = await withSlot(() => renderPdf(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'content-type': 'application/pdf' }).end(Buffer.from(pdf));
      } catch (error) {
        res.writeHead(error instanceof RenderTimeoutError ? 504 : 500).end();
      }
    })();
  });
}).listen(PORT, '0.0.0.0');
```

`0.0.0.0` is correct **inside the container**; the loopback binding is done by the compose port mapping, exactly as MariaDB's `127.0.0.1:3308:3306` does it.

```dockerfile
# server/docker/pdf/Dockerfile
# Tag pinned by Task 1 — do NOT float it.
FROM mcr.microsoft.com/playwright:v<VERSION>-noble

WORKDIR /app

# Fonts first: the export HTML carries its font stack BY NAME, so a missing
# face renders tofu rather than failing. Pretendard and JetBrains Mono are
# already dependencies of the web app, so the image takes them from
# node_modules rather than fetching anything at build time.
COPY node_modules/pretendard/dist/public/variable/*.woff2 /usr/share/fonts/pretendard/
COPY node_modules/@fontsource-variable/jetbrains-mono/files/*.woff2 /usr/share/fonts/jetbrains/
RUN fc-cache -f

COPY server/pdf ./server/pdf
COPY package.json ./
RUN npm install --omit=dev playwright tsx

EXPOSE 8788
CMD ["npx", "tsx", "server/pdf/server.ts"]
```

- [ ] **Step 8: Add the compose service**

```yaml
  pdf:
    build:
      context: ../..
      dockerfile: server/docker/pdf/Dockerfile
    container_name: markflowing-pdf
    restart: unless-stopped
    ports:
      # Loopback ONLY, for the same reason MariaDB is: published on all
      # interfaces this renderer is reachable from anything on the Mini's LAN,
      # which bypasses the session cookie and the rate limiter in one hop.
      - '127.0.0.1:8788:8788'
    mem_limit: 1g
    pids_limit: 512
    healthcheck:
      test: ['CMD', 'node', '-e', "require('http').get('http://127.0.0.1:8788/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
```

- [ ] **Step 9: Build the image and re-run the font test inside it**

```bash
docker compose -f server/docker-compose.yml build pdf
docker compose -f server/docker-compose.yml up -d pdf
curl -s -o /tmp/g.pdf -X POST --data-binary '<body style="font-family:Pretendard">안녕하세요</body>' \
  -H 'content-type: text/html' http://127.0.0.1:8788/render
head -c 5 /tmp/g.pdf          # expect %PDF-
strings /tmp/g.pdf | grep -i pretendard | head -1   # expect a hit
```

**If the grep finds nothing, the fonts did not land** — check the `COPY` globs against the real paths in `node_modules`, which differ between Pretendard releases.

- [ ] **Step 10: Add npm scripts, run all six gates, commit**

Add to `package.json`: `"pdf:up"`, `"pdf:down"`, `"pdf:build"` wrapping the compose commands, and `"test:pdf": "vitest run --project pdf"`.

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(pdf): a containerised Chromium renderer, with its SSRF guard proven

Five controls: JS denied, every subresource request aborted, setContent
rather than goto, loopback-only publication, and a bounded queue with a
periodic browser restart under a hard mem_limit.

The route-abort test is the one that matters and was fault-injected: without
it the renderer fetches img, link, iframe and @font-face URLs from inside the
network. The Korean font test asserts an embedded Pretendard subset rather
than extracting text, because text extraction cannot see tofu — a missing
glyph still extracts as its codepoint."
```

---

## Task 4: The authenticated pass-through route

**Files:**
- Create: `server/src/http/body.ts`, `server/src/routes/export.ts`, `server/src/routes/export.test.ts`
- Modify: `server/src/routes/sync.ts` (import the extracted helper), `server/src/app.ts`, `server/src/env.ts`, `server/.env`, `server/.env.local`

**Interfaces:**
- Consumes: `AppDeps`, `Query` from `../app.ts`; `authenticator` from `../auth/authenticate.ts`; `rateLimit`, `clientIp` from `../middleware/rateLimit.ts`; `cookieName`, `readCookie`, `SESSION_COOKIE` from `../auth/cookies.ts`.
- Produces:
  - `readCappedBody(request: Request, maxBytes: number): Promise<string | null>` in `server/src/http/body.ts`
  - `exportRoutes(deps: AppDeps): Hono`
  - `Env.pdfRendererUrl: string`
  - `MAX_EXPORT_BYTES = 2 * 1024 * 1024`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/routes/export.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.ts';
// Reuse the harness the sync route tests already use for a signed-in request.
import { signedInDeps, withSessionCookie } from './testSupport.ts';

const HTML = '<html><body>hi</body></html>';

function pdfFetch(status = 200, body = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) {
  return vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/pdf' } }));
}

describe('POST /export/pdf', () => {
  it('rejects an unauthenticated caller', async () => {
    const app = createApp(await signedInDeps({ authenticated: false }));
    const res = await app.request('/export/pdf', { method: 'POST', body: HTML });
    expect(res.status).toBe(401);
  });

  it('returns the renderer output as application/pdf', async () => {
    const deps = await signedInDeps({ rendererFetch: pdfFetch() });
    const res = await app(deps).request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    );
  });

  it('rejects a body over the cap WITHOUT calling the renderer', async () => {
    // Order matters: a cap enforced after the forward is not a cap.
    const renderer = pdfFetch();
    const deps = await signedInDeps({ rendererFetch: renderer });
    const res = await app(deps).request(
      '/export/pdf',
      withSessionCookie({ method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) }),
    );

    expect(res.status).toBe(413);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('answers 503 when the renderer cannot be reached', async () => {
    const deps = await signedInDeps({
      rendererFetch: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const res = await app(deps).request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));
    expect(res.status).toBe(503);
  });

  it('passes a renderer timeout through as 504', async () => {
    const deps = await signedInDeps({ rendererFetch: pdfFetch(504, new Uint8Array()) });
    const res = await app(deps).request('/export/pdf', withSessionCookie({ method: 'POST', body: HTML }));
    expect(res.status).toBe(504);
  });
});
```

Read `server/src/routes/sync.test.ts` first and reuse **its** existing signed-in harness verbatim rather than inventing `testSupport.ts`; if sync's helpers are local to that file, extract them to `server/src/routes/testSupport.ts` in this task and point both files at it.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --project server server/src/routes/export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extract `readCappedBody`**

Move the function from `server/src/routes/sync.ts` into `server/src/http/body.ts`, taking `maxBytes` as a parameter instead of closing over the module constant. Keep its docblock — the "Content-Length is the fast path and is deliberately not trusted as the only one" reasoning is the whole point of the helper. Update `sync.ts` to import it and pass `MAX_BODY_BYTES`.

- [ ] **Step 4: Run the sync tests to prove the extraction changed nothing**

Run: `npx vitest run --project server server/src/routes/sync.test.ts`
Expected: PASS, unchanged count.

- [ ] **Step 5: Write the route**

```ts
// server/src/routes/export.ts
import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import { readCappedBody } from '../http/body.ts';

/**
 * The largest document this service will render, in bytes.
 *
 * A note's text is quota-limited to 10 MiB, but the EXPORT HTML is a rendered
 * document, not the text, and 2 MiB of it is already an unreasonably large
 * single note. The cap exists because a render is the most expensive thing
 * this service does: without it, one POST of arbitrary size is buffered into
 * memory on a Mac Mini and then handed to a browser.
 */
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

export function exportRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.post('/export/pdf', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.body(null, 401);

    // Before the forward, deliberately. A cap enforced after the renderer has
    // been handed the body is not a cap.
    const html = await readCappedBody(c.req.raw, MAX_EXPORT_BYTES);
    if (html === null) return c.body(null, 413);

    let response: Response;
    try {
      response = await deps.fetch(`${deps.env.pdfRendererUrl}/render`, {
        method: 'POST',
        headers: { 'content-type': 'text/html' },
        body: html,
      });
    } catch {
      // Unreachable is not the same as broken: the renderer is a separate
      // container that can be restarting, and the client's message differs.
      return c.body(null, 503);
    }

    if (response.status === 504) return c.body(null, 504);
    if (!response.ok) return c.body(null, 502);

    c.header('content-type', 'application/pdf');
    return c.body(await response.arrayBuffer());
  });

  return app;
}
```

- [ ] **Step 6: Wire it into the app with its own tighter limit**

In `server/src/app.ts`, register **before** the catch-all limiter, keyed the same way `/sync` is — on the extracted session token, never the raw cookie header:

```ts
app.use(
  '/export/*',
  rateLimit({
    // Far tighter than /sync's 120: one render costs orders of magnitude more
    // than a sync round-trip, and it runs a browser rather than a query.
    limit: 10,
    windowMs: 60_000,
    key: (c) => readCookie(c.req.header('cookie'), sessionCookieName) ?? clientIp(c),
  }),
);
```

and `app.route('/', exportRoutes(deps));` beside the others.

- [ ] **Step 7: Add the env var**

Add `pdfRendererUrl: require_(source, 'PDF_RENDERER_URL')` to `readEnv`, and `PDF_RENDERER_URL=http://127.0.0.1:8788` to both `server/.env` and `server/.env.local`. Reading it at boot rather than at the call site keeps a misconfiguration a startup failure naming the key, which is the file's existing rule.

- [ ] **Step 8: Run and watch the tests pass**

Run: `npx vitest run --project server`
Expected: PASS.

- [ ] **Step 9: Fault-inject the cap ordering**

Move the `readCappedBody` check to *after* the `deps.fetch` call. Confirm the "WITHOUT calling the renderer" test goes red. Restore.

- [ ] **Step 10: All six gates, then commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(server): an authenticated /export/pdf pass-through

Session required, rate-limited to 10/min against /sync's 120 because a render
runs a browser rather than a query, body capped at 2 MiB BEFORE the forward,
and 503 kept distinct from 502 because an unreachable container and a broken
render are different things to tell the user.

readCappedBody moves to server/src/http/body.ts now that it has a second
consumer; sync's tests prove the extraction changed nothing."
```

---

## Task 5: The client transport, and deleting the print pipeline

**Files:**
- Create: `src/features/export/requestPdf.ts`, `src/features/export/requestPdf.test.ts`
- Delete: `src/features/export/print.ts`, `src/features/export/print.test.ts`
- Modify: `src/features/export/exportNote.ts`, `src/features/export/filename.ts`, `src/features/export/index.ts`, `src/features/notes/NoteEditor.tsx`

**Read first:** `docs/rulings/export.md`.

**Interfaces:**
- Consumes: `API_ORIGIN` from `@/data/sync/config`; `downloadBlob(filename, blob, doc)` from `@/lib/download`; `exportFilename(note, ext)` from `./filename`.
- Produces:
  - `type PdfFailure = 'offline' | 'unauthorized' | 'tooLarge' | 'rateLimited' | 'unavailable' | 'failed'`
  - `class PdfExportError extends Error { readonly reason: PdfFailure }`
  - `requestPdf(html: string, deps?: { fetch?: typeof globalThis.fetch }): Promise<Blob>`
  - `ExportExtension` in `filename.ts` widens to `'md' | 'html' | 'pdf'`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/export/requestPdf.test.ts
import { describe, expect, it, vi } from 'vitest';

import { PdfExportError, requestPdf } from './requestPdf';

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe('requestPdf', () => {
  it('POSTs the html with credentials and returns the bytes', async () => {
    const fetch = vi.fn(async () => new Response(pdfBytes, { status: 200 }));
    const blob = await requestPdf('<p>x</p>', { fetch: fetch as never });

    // Duck-typed: vitest.setup.ts swaps the global Blob for Node's, so
    // `instanceof Blob` is false under test and true in a browser.
    expect(typeof blob.arrayBuffer).toBe('function');

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/export\/pdf$/);
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).body).toBe('<p>x</p>');
  });

  it.each([
    [401, 'unauthorized'],
    [413, 'tooLarge'],
    [429, 'rateLimited'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [500, 'failed'],
  ])('maps %i to %s', async (status, reason) => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    await expect(requestPdf('<p>x</p>', { fetch: fetch as never })).rejects.toMatchObject({ reason });
  });

  it('maps a thrown fetch to offline, not to a generic failure', async () => {
    // The user with no connectivity needs a different sentence from the user
    // whose server is broken; a single "export failed" hides which it is.
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(requestPdf('<p>x</p>', { fetch: fetch as never })).rejects.toMatchObject({
      reason: 'offline',
    });
    await expect(requestPdf('<p>x</p>', { fetch: fetch as never })).rejects.toBeInstanceOf(
      PdfExportError,
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/export/requestPdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the transport**

```ts
// src/features/export/requestPdf.ts
import { API_ORIGIN } from '@/data/sync/config';

export type PdfFailure =
  | 'offline'
  | 'unauthorized'
  | 'tooLarge'
  | 'rateLimited'
  | 'unavailable'
  | 'failed';

export class PdfExportError extends Error {
  readonly reason: PdfFailure;

  constructor(reason: PdfFailure) {
    super(`pdf export failed: ${reason}`);
    this.name = 'PdfExportError';
    this.reason = reason;
  }
}

const BY_STATUS: Record<number, PdfFailure> = {
  401: 'unauthorized',
  413: 'tooLarge',
  429: 'rateLimited',
  502: 'unavailable',
  503: 'unavailable',
  504: 'unavailable',
};

/**
 * Sends the rendered document to the API and returns the PDF.
 *
 * The FILENAME is deliberately absent from this request. The client already
 * computes it with `exportFilename`, so no client-controlled string reaches a
 * `Content-Disposition` header on the server.
 *
 * A thrown fetch is mapped to `offline` rather than to a generic failure: a
 * user with no connectivity and a user whose renderer is down need different
 * sentences, and collapsing them tells neither of them anything.
 */
export async function requestPdf(
  html: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<Blob> {
  const doFetch = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(`${API_ORIGIN}/export/pdf`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'text/html' },
      body: html,
    });
  } catch {
    throw new PdfExportError('offline');
  }

  if (!response.ok) throw new PdfExportError(BY_STATUS[response.status] ?? 'failed');

  return new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/features/export/requestPdf.test.ts`
Expected: PASS, 8 assertions across 3 tests.

- [ ] **Step 5: Rewire `exportNote` and delete the print pipeline**

In `exportNote.ts`: drop the `printHtmlDocument` import and `ExportNoteDeps.print`, add an optional `fetch` dep, and replace the final line with:

```ts
const blob = await requestPdf(html, { fetch: deps.fetch });
download(exportFilename(note, 'pdf'), blob, doc);
```

Rewrite the module docblock: the argument against a client-side generator survives, but its conclusion moves from "so we print" to "so the server renders it".

Widen `ExportExtension` in `filename.ts` to `'md' | 'html' | 'pdf'` and delete its "`pdf` goes through the browser's print pipeline and never reaches this" clause, which is now false.

```bash
git rm src/features/export/print.ts src/features/export/print.test.ts
```

- [ ] **Step 6: Map the failure onto the editor's existing status line**

`NoteEditor.handleExport` currently sets a single `exportFailed` boolean. Change it to hold `PdfFailure | null` and render the matching key. Task 6 adds the keys; until then use `export.failed` for every reason so this step compiles and the suite stays green.

- [ ] **Step 7: Run the export and editor suites**

Run: `npx vitest run src/features/export src/features/notes`
Expected: PASS. `exportNote.test.ts` will need its `print` dep replaced with a stubbed `fetch`.

- [ ] **Step 8: All six gates, then commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(export): send the document to the API, delete the print pipeline

print.ts, PrintDeps and printHtmlDocument are gone: one path, one document.
The filename never crosses the wire — the client already computes it, so no
client-controlled string can reach a Content-Disposition header.

A thrown fetch maps to 'offline' rather than a generic failure, because a user
with no connectivity and a user whose renderer is down need different
sentences."
```

---

## Task 6: The menu — the disabled state, the glyph, and six messages

**Files:**
- Modify: `src/features/export/ExportMenu.tsx`, `src/features/export/ExportMenu.test.tsx`, `src/features/notes/NoteEditor.tsx`, `src/i18n/en.ts`, `src/i18n/ko.ts`
- Test: `src/features/export/ExportMenu.test.tsx`

**Read first:** `docs/rulings/accessibility.md`, and `docs/rulings/export.md`'s note on `ALLOWED_IDENTICAL`.

**Interfaces:**
- Consumes: `useSessionValue()` from `@/features/account`; `PdfFailure` from `./requestPdf`.
- Produces: `ExportMenuProps` unchanged in shape — the session is read from context, not drilled through `RichEditor`, which has no business knowing about accounts.

- [ ] **Step 1: Write the failing tests**

```tsx
it('disables PDF when signed out, and says why', () => {
  renderMenu({ session: { status: 'signedOut' } });
  const pdf = screen.getByRole('menuitem', { name: /PDF/ });

  // aria-disabled, NOT disabled: a disabled button is skipped by the tab
  // order, so a keyboard user cannot reach it to discover why it is off.
  expect(pdf).toHaveAttribute('aria-disabled', 'true');
  expect(pdf).not.toBeDisabled();
  expect(pdf).toHaveAccessibleName(/sign in/i);
});

it('does not fire onChoose for a disabled PDF item', async () => {
  const onChoose = vi.fn();
  renderMenu({ session: { status: 'signedOut' }, onChoose });
  await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
  expect(onChoose).not.toHaveBeenCalled();
});

it('leaves Markdown and HTML enabled when signed out', () => {
  renderMenu({ session: { status: 'signedOut' } });
  expect(screen.getByRole('menuitem', { name: /Markdown/ })).not.toHaveAttribute('aria-disabled');
});

it('enables PDF when signed in', () => {
  renderMenu({ session: { status: 'signedIn', account: { email: 'a@b.c' } } });
  expect(screen.getByRole('menuitem', { name: /PDF/ })).not.toHaveAttribute('aria-disabled', 'true');
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/features/export/ExportMenu.test.tsx`
Expected: FAIL — no `aria-disabled` on any item.

- [ ] **Step 3: Add the i18n keys**

To `en.ts`, beside the existing `export.*` block:

```ts
'export.pdf.requiresSignIn': 'Sign in to export PDF',
'export.failed.offline': 'PDF export needs a connection.',
'export.failed.unauthorized': 'Your session expired. Sign in again to export PDF.',
'export.failed.tooLarge': 'This note is too large to export as PDF.',
'export.failed.rateLimited': 'Too many exports — try again shortly.',
'export.failed.unavailable': 'PDF export is unavailable right now.',
```

and the Korean translations in `ko.ts`. Do **not** add these to `ALLOWED_IDENTICAL` — they are sentences, not proper nouns, and Korean renders every one of them.

- [ ] **Step 4: Implement the disabled item and swap the glyph**

Read the session with `useSessionValue()` inside `ExportMenu`. A choice gains an optional `disabledWhenSignedOut: true`; the PDF row carries it. The rendered button gets `aria-disabled`, an `aria-describedby` or appended accessible name carrying `export.pdf.requiresSignIn`, and an `onClick` that returns early rather than a `disabled` attribute.

Swap `Printer` for `FileText` in the `CHOICES` table and **delete the comment** explaining that a printer icon is honest because a dialog is coming — it no longer is. Add `FileText` to `src/ui/Icon.tsx`'s `ICON_NODES` verbatim from lucide, plus its row in `Icon.test.tsx`'s `it.each`, if it is not already there. Remember `renderIconMarkup` takes a LIST of shapes.

- [ ] **Step 5: Render the specific failure message**

In `NoteEditor.tsx`, map the `PdfFailure` held in state to its key, falling back to `export.failed`.

- [ ] **Step 6: Run and watch them pass**

Run: `npx vitest run src/features/export src/features/notes src/i18n src/ui/Icon.test.tsx`
Expected: PASS.

- [ ] **Step 7: Fault-inject the accessible name**

Remove the `export.pdf.requiresSignIn` text from the disabled item's accessible name. Confirm `toHaveAccessibleName(/sign in/i)` goes red — an `aria-disabled` item that does not say why is the failure this test exists for. Restore.

- [ ] **Step 8: All six gates, then commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "feat(export): gate PDF on sign-in, and say so where it can be heard

aria-disabled rather than disabled: a disabled button leaves the tab order,
so a keyboard user cannot reach the item to discover why it is off. The
reason is in the accessible name, fault-injected.

The printer glyph goes with the print pipeline; the comment claiming a
printer icon is honest because a dialog is coming was true and now is not."
```

---

## Task 7: Make the theme authoritative, and correct fd4c32f's reason

**Files:**
- Modify: `src/features/export/html.ts`, `src/features/export/html.test.ts`

**Read first:** `docs/rulings/testing-and-tooling.md` — this task edits a test **because a design decision removed its subject**, which is the adjacent case to the one that ruling governs, and the distinction must be argued in the commit rather than assumed.

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; `renderNoteHtml`'s output loses its `@media print` background reset.

- [ ] **Step 1: Change the test to the new rule**

Delete `'still clears the PAGE background when printing, so a dark theme does not flood the sheet'` and replace it:

```ts
it('lets the theme own the page background even when printed', () => {
  // G's ruling: a PDF matches the app exactly, dark page and all. The old
  // @media print reset cleared html/body and left --bear-text alone, so a
  // Nord export printed near-white text onto white paper — the defect that
  // motivated G, not a feature being removed.
  const html = renderNoteHtml(note, tokens);
  expect(html).not.toMatch(/@media print \{[^}]*html, body \{[^}]*background: none/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/export/html.test.ts`
Expected: FAIL — the rule is still in the stylesheet.

- [ ] **Step 3: Remove the reset**

Delete the `html, body { background: none; }` rule from the `@media print` block in `html.ts`. Keep the block's `body { padding: 0; max-width: none; }` — page geometry belongs to `@page`, and that part was never the defect.

- [ ] **Step 4: Correct `print-color-adjust`'s stated reason**

The declaration **stays**; only its justification changes. Rewrite the comment above the `html` rule so it explains the reader it now serves — someone who downloads the HTML export and prints it from their own browser — and stops referring to a PDF pipeline that no longer exists. Update the sibling test's comment for the same reason. Do not weaken the anchored regex: it was vacuous once already because `-webkit-print-color-adjust` contains the unprefixed string.

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run src/features/export/html.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify against a real dark theme, by eye**

```bash
npm run pdf:up
npm run dev
```

Switch to Nord, export a note with a code block, and open the PDF. **Expected: a dark page with legible light text.** A white page means the reset was not fully removed; near-white text on white means it was removed from the wrong rule.

- [ ] **Step 7: All six gates, then commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add -A
git commit -m "fix(export): the theme owns the page, printed or not

The @media print reset cleared html/body and left --bear-text alone, so a note
exported under a dark theme rendered near-white text onto white paper. That is
the defect G was specced to fix, so the rule goes rather than being patched.

This edits a test written three days ago, and the distinction matters: the
test is changed because a ruling removed its subject, not because a restyle
made it inconvenient. print-color-adjust: exact stays — it still governs
someone printing the downloaded HTML — but its stated reason named a PDF
pipeline that no longer exists, and a comment that lies is worse than none."
```

---

## Task 8: End-to-end proof, the shots, and the documentation

**Files:**
- Create: `e2e/pdfExport.spec.ts`, `e2e/shots-pdf.spec.ts`
- Modify: `e2e/notes.spec.ts`, `playwright.config.ts`, `package.json`, `server/README.md`, `docs/rulings/export.md`, `CLAUDE.md`, `docs/superpowers/NEXT.md`, `.gitignore`

**Interfaces:**
- Consumes: the signed-in fixture in `e2e/sync.spec.ts`; the corpus in `e2e/fixtures/corpus.ts`.
- Produces: `npm run shots:pdf`.

- [ ] **Step 1: Write the failing e2e test**

```ts
// e2e/pdfExport.spec.ts
test('a signed-in user downloads a real PDF', async ({ page }) => {
  await seedDatabase(page, corpus);
  await signIn(page);              // reuse sync.spec.ts's fixture
  await page.goto('/');

  await page.getByRole('button', { name: /export/i }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /PDF/ }).click();

  const file = await (await download).path();
  const bytes = await readFile(file!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(1_000);
});

test('a signed-out user is told why PDF is unavailable', async ({ page }) => {
  await seedDatabase(page, corpus);
  await page.goto('/');
  await page.getByRole('button', { name: /export/i }).click();

  const pdf = page.getByRole('menuitem', { name: /PDF/ });
  await expect(pdf).toHaveAttribute('aria-disabled', 'true');
  await expect(pdf).toHaveAccessibleName(/sign in/i);
});
```

The first test needs the renderer up. Guard it with `test.skip(!process.env.PDF_RENDERER_URL, ...)` and mirror `migrate.test.ts` by asserting the variable **is** present when `CI` is set, so a green CI that rendered nothing fails loudly.

- [ ] **Step 2: Run and watch it fail, with the port killed first**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run pdf:up
PDF_RENDERER_URL=http://127.0.0.1:8788 npx playwright test e2e/pdfExport.spec.ts
```

Expected: FAIL on the download never arriving, or on the missing `aria-disabled` if Task 6 regressed.

- [ ] **Step 3: Fix whatever it finds, then watch it pass**

Expected: PASS, 2 tests.

- [ ] **Step 4: Update the existing export block in `e2e/notes.spec.ts`**

Its PDF assertions assume a print dialog. Replace them; keep the HTML-export geometry test exactly as it is — it loads the downloaded file with `page.goto('file://…')` under a real `.html` name for reasons documented in `docs/rulings/export.md`, and none of that changed.

- [ ] **Step 5: Add `npm run shots:pdf`**

`e2e/shots-pdf.spec.ts`, tagged `@shots` so `playwright.config.ts`'s existing `grepInvert` keeps it out of `npm run test:e2e`. Render the corpus note to PDF in four themes spanning the roster — one light, one dark, `high-contrast`, `sepia` — selecting each through the paint-time mirror the way `shots.spec.ts` does, never through `colorScheme`. Rasterize page 1 into `docs/design/shots/pdf/`, and add that path to `.gitignore`.

**Verify by counting files (4), not by trusting the exit code** — the same rule `npm run shots` carries.

- [ ] **Step 6: Rewrite the rulings**

In `docs/rulings/export.md`, replace the "PDF is the browser's print pipeline" bullet wholesale with G's ruling: server-rendered, sign-in required, the five security controls named, and the reason the client still builds the document (the `server/` import boundary). Add a bullet for the Korean-font test trap — that a text extraction cannot see tofu — because that is exactly the class of silent-pass this project keeps writing down.

In `CLAUDE.md`: update the architecture summary, and amend the local-first paragraph to name export as the **second** thing requiring the network after sync, plus the ruling that PDF is the first capability that does not exist without an account. Update the test counts.

In `docs/superpowers/NEXT.md`: mark G shipped, and name the format roster as the follow-up with the formats it would cover.

- [ ] **Step 7: Document the deployment**

In `server/README.md`: the `pdf` compose service, `PDF_RENDERER_URL` in both env files, the `pdf:*` npm scripts, the pinned image tag from Task 1 with its measured size, and the reminder that `server:service:stop` comes before `server:dev:local`.

- [ ] **Step 8: All six gates plus the PDF project, then commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test && npm run build
npm run test:pdf
lsof -ti:4173 | xargs -r kill -9
npm run pdf:up && PDF_RENDERER_URL=http://127.0.0.1:8788 npm run test:e2e
git add -A
git commit -m "test(g): end-to-end PDF proof, four reference shots, and G's rulings"
```

---

## Self-Review

**Spec coverage.** Architecture §1 client-builds-the-document → Task 5; §2 Hono pass-through → Task 4; §3 renderer container → Task 3. Data flow → Tasks 3–5. Security's five controls → Task 3 Steps 3, 5, 7, 8. Error handling's eight rows → Task 5 (transport mapping) and Task 6 (messages and the disabled item). "What G deletes or rewrites" → Task 5 (print.ts, docblock, `ExportExtension`), Task 6 (glyph), Task 7 (`@media print`, `fd4c32f`'s reason), Task 8 (rulings, e2e, CLAUDE.md, NEXT.md). Testing → every task, plus Task 8 for e2e and `shots:pdf`. Deployment → Task 3 Steps 7–8 and Task 8 Step 7. Risks → Task 1. **One gap found and closed:** the spec assumes the export menu can read session state, and it could not — `useSession` had a single caller and no sharing. Task 2 was added for it.

**Placeholder scan.** No "TBD", "TODO" or "similar to Task N". Two steps are deliberately descriptive rather than complete code: Task 6 Step 4 (the disabled-item markup, which must match `ExportMenu`'s existing class strings and `docs/rulings/accessibility.md`'s pattern, both of which the implementer reads first) and Task 8 Step 5 (which must match `shots.spec.ts`'s theme-selection helper, a file the implementer has to read). Both name the exact file to copy and every difference from it. `<VERSION>` in Task 3's Dockerfile is filled from Task 1 Step 2 and is explicitly a pin, not a placeholder.

**Type consistency.** `renderPdf(html, deps)` and `RenderTimeoutError` match between Task 3's test, implementation and `server.ts`. `readCappedBody(request, maxBytes)` has the same signature in Task 4 Steps 3 and 5 and in `sync.ts`'s updated call. `PdfFailure`'s six members match between `requestPdf.ts`, its test's `it.each`, the six i18n keys in Task 6 Step 3, and `NoteEditor`'s map. `useSessionValue()` — not `useSession()` — is the name in Task 2's implementation, Task 2 Step 5's `AccountMenu` change and Task 6's `ExportMenu`. `exportFilename(note, 'pdf')` requires Task 5 Step 5's widening of `ExportExtension`, which is in the same task.

**One inconsistency found and fixed:** Task 4's route returns 502 for a non-OK renderer response, but the spec's error table has no 502 row. The transport in Task 5 maps 502 → `unavailable`, the same as 503, so the user-facing behaviour matches the spec's "renderer down" row. Left as 502 on the wire deliberately — it distinguishes "renderer answered badly" from "renderer unreachable" in the server's own logs, which is worth more than table symmetry.
