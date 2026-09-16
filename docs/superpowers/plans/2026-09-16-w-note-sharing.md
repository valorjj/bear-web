# Sub-project W — note sharing and import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader who opens a published note's URL can add that note — its
text and its images — to their own notes, with no account and no copy-paste.

**Architecture:** The importable payload rides inside the already-published
HTML document: `inlineImages` stops deleting the `data-src` attribute it
currently removes, and `renderNoteHtml` appends an inert
`<script type="application/json" id="bear-source">` block carrying the note's
Markdown. The public page gains a plain `<a>` pointing at
`${APP_ORIGIN}/?import=<id>`. The app fetches the same stored bytes from a new
anonymous `GET /share/:id` on the API host, parses them, and writes a brand-new
note with brand-new image ids into IndexedDB. No new table, no new column, no
second copy of any image.

**Tech Stack:** TypeScript, React 19, Tiptap/ProseMirror, Dexie (IndexedDB),
Hono on Node, MariaDB, Vitest, Playwright, Tailwind v4, oxlint.

**Spec:** `docs/superpowers/specs/2026-09-16-note-sharing-design.md`

## Global Constraints

These apply to every task. They are not restated per task.

- **All six gates must pass before any commit:** `npm test`, `npm run test:e2e`,
  `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **Check exit codes, not pass counts.** An uncaught error makes `vitest run`
  exit 1 with every assertion passing. Read `$?`.
- **Repetition targets FILES, never the suite.** `npx vitest run <path>` is
  ~2-3s; a full run is ~80 CPU-seconds on a fanless machine that also hosts the
  API service. Use `--maxWorkers=4` for any full run.
- **No user-facing string is hardcoded.** Every one goes through `useT`.
  `src/i18n/en.ts` defines the key type; `src/i18n/ko.ts` is annotated
  `Record<TranslationKey, string>`, so a missing Korean string is a compile
  error. Never weaken that annotation — add the translation.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()`
  outside `src/styles/tokens.css` is a defect.
- **Spacing uses only the permitted steps** `0 0.5 1 2 3 4 6 8 12 px auto full`
  (`scripts/sourceLint.test.ts`).
- **Components reach persistence only through `src/data/index.ts`**, never a
  repository module directly.
- **`src/data/` must not import from `src/features/`.**
- **`server/` may import nothing from `src/` but `src/data/types.ts`**
  (`scripts/serverBoundaries.test.ts`).
- **Every SQL statement naming a user-scoped table must constrain `user_id`**
  in a predicate position, or carry `/* tenancy-ok: reason */` on its own line
  or exactly one line above.
- **`vitest.setup.ts` swaps the global `Blob` for Node's.** In tests,
  `instanceof Blob` and `instanceof ArrayBuffer` are FALSE even for real ones.
  **Duck-type in tests; never `instanceof`.** This plan touches blobs in four
  tasks.
- **jsdom implements neither `createImageBitmap` nor `OffscreenCanvas`.** Any
  code needing them takes them as injected dependencies, exactly as
  `src/features/notes/downscale.ts` already does.
- **Before trusting any e2e result that follows a source change:**
  `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` hardcodes port 4173
  with `reuseExistingServer`, so a stale preview server silently tests an old
  build.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Branch:** work on `feat/w-note-sharing`, cut from `main`. The controller
  merges; do not touch `main` yourself.

### Values fixed by this plan

| Thing | Value |
| --- | --- |
| Payload element | `<script type="application/json" id="bear-source">` |
| Payload shape | `{ "title": string, "text": string }` |
| Import URL | `${APP_ORIGIN}/?import=<pageId>` |
| Payload route | `GET /share/:id` on the API host |
| Payload route rate limit | `{ limit: 120, windowMs: 60_000, key: clientIp }` |
| Page id shape | `/^[A-Za-z0-9_-]+$/` |
| Max payload text | 1,000,000 characters |

---

### Task 1: The export document carries its own source

**Files:**

- Modify: `src/features/export/html.ts` — `inlineImages` (around line 416),
  `renderNoteHtml` (around line 528, and its `<body>` at the end)
- Test: `src/features/export/html.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: an exported document that satisfies both of these, which Task 4
  parses:
  - every inlined image keeps `data-src="files/<id>.webp"` alongside its
    `src="data:…"`
  - `<script type="application/json" id="bear-source">` exists in `<body>`,
    containing `{"title": string, "text": string}` with `</script>` escaped as
    `<\/script>`

**Read first:** `docs/rulings/export.md`. It is the trigger file for
`html.ts`, `renderNoteHtml` and `inlineImages` — every symbol this task
touches is named in its trigger line.

**Two hazards in this file specifically.** `renderNoteHtml`'s body is ONE
template literal: a backtick written anywhere in the new code, INCLUDING in a
comment beside it, terminates the literal, and the parse error points at the
prose rather than at the backtick — ten unrelated test files then fail to load
at once because this module is widely imported. And U+00A0 / U+200B have both
been introduced into this repo invisibly before; after editing, verify with
`python3 -c "d=open('src/features/export/html.ts').read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"`
which must print `0 0`.

- [ ] **Step 1: Write the failing tests**

Add to `src/features/export/html.test.ts`:

```ts
describe('the importable payload', () => {
  it('keeps data-src on an inlined image so an importer can match it to the text', () => {
    const images = new Map([['abc123', 'data:image/webp;base64,AAAA']]);
    const html = renderNoteHtml(
      { title: 'Note', text: 'Note\n\n![](files/abc123.webp)\n' },
      {},
      'en',
      images,
    );

    expect(html).toContain('data-src="files/abc123.webp"');
    expect(html).toContain('src="data:image/webp;base64,AAAA"');
  });

  it('carries the note title and text as an inert JSON block', () => {
    const html = renderNoteHtml({ title: 'Note', text: 'Note\n\nbody\n' }, {}, 'en');

    const match = /<script type="application\/json" id="bear-source">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual({ title: 'Note', text: 'Note\n\nbody\n' });
  });

  it('escapes a closing script tag in the note text', () => {
    // Without this the payload block terminates early and the rest of the
    // note becomes markup in the document.
    const text = 'Note\n\n</script><b>x</b>\n';
    const html = renderNoteHtml({ title: 'Note', text }, {}, 'en');

    const match = /<script type="application\/json" id="bear-source">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!).text).toBe(text);
  });

  it('still drops an image whose bytes are absent', () => {
    // Unchanged behaviour, pinned here because this task edits the branch
    // that decides it: a note synced before its image arrived must export
    // without a broken-image icon.
    const html = renderNoteHtml(
      { title: 'Note', text: 'Note\n\n![](files/missing.webp)\n' },
      {},
      'en',
      new Map(),
    );

    expect(html).not.toContain('files/missing.webp');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/features/export/html.test.ts
```

Expected: the first three FAIL (`data-src` absent, no `bear-source` block).
The fourth PASSES already — it pins existing behaviour.

- [ ] **Step 3: Keep `data-src` in `inlineImages`**

In `src/features/export/html.ts`, inside `inlineImages`, delete the
`element.removeAttribute('data-src');` line and replace the surrounding
comment with:

```ts
    element.setAttribute('src', dataUri);
    // `data-src` is KEPT, deliberately, where it used to be removed here.
    // It is the only thing that lets an importer match an inlined blob back
    // to its `files/<id>.webp` path in the Markdown — the alternative is
    // document order, which is true but silently wrong the first time a
    // renderer reorders anything. It costs one attribute per image and a
    // reader never sees it. See sub-project W.
```

- [ ] **Step 4: Append the payload block in `renderNoteHtml`**

Add above `renderNoteHtml`, at module scope:

```ts
/**
 * The note's own Markdown, carried inside the document it renders to.
 *
 * `type="application/json"` is never executed by any browser, so the
 * published page's CSP (`default-src 'none'`) neutralises nothing here and
 * needs no change to permit it — it is inert data in the DOM, which is
 * exactly what an importer wants and what a reader never sees.
 *
 * Only the CLOSING tag is escaped, and that is sufficient: an HTML parser
 * ends a script element at the first `</script`, and nothing else inside a
 * script element is markup. `JSON.stringify` has already dealt with quotes,
 * backslashes and control characters.
 */
function sourcePayload(note: RenderableNote): string {
  const json = JSON.stringify({ title: note.title, text: note.text }).replace(
    /<\/script/gi,
    String.raw`<\/script`,
  );
  return `<script type="application/json" id="bear-source">${json}</script>`;
}
```

Then, in `renderNoteHtml`'s returned template literal, change the `<body>` to:

```
  <body>
${renderNoteBody(note.text, images, diagrams)}
${sourcePayload(note)}
  </body>
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/features/export/html.test.ts
```

Expected: PASS, exit 0. Read the exit code, not the summary line.

- [ ] **Step 6: Run the whole export surface, which this file feeds**

```bash
npx vitest run src/features/export src/features/publish
python3 -c "d=open('src/features/export/html.ts').read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"
```

Expected: PASS, and `0 0`. Existing snapshot-ish assertions on the exported
document may need updating for the new block — if one fails, update it, and
state in the commit which assertion moved and why.

- [ ] **Step 7: Commit**

```bash
git add src/features/export/html.ts src/features/export/html.test.ts
git commit -m "feat(export): the rendered document carries its own Markdown

\`inlineImages\` stops deleting \`data-src\` and \`renderNoteHtml\` appends an
inert \`application/json\` block holding the note's title and text. Together
they make an exported or published document importable: the attribute maps
each inlined blob back to its path in the text, and the block is the text.

Only the closing script tag is escaped, which is sufficient — an HTML parser
ends a script element at the first \`</script\` and nothing else inside one is
markup.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /share/:id` serves the payload

**Files:**

- Create: `server/src/routes/share.ts`
- Create: `server/src/routes/share.test.ts`
- Modify: `server/src/app.ts` — the rate-limit block around line 151, and the
  `app.route` block around line 162
- Modify: `scripts/serverBoundaries.test.ts` — the publish-host assertions

**Interfaces:**

- Consumes: nothing from Task 1 at runtime. The route returns whatever is on
  disk.
- Produces: `GET ${API_ORIGIN}/share/<id>` → `200` with the stored HTML as
  `text/html; charset=utf-8`, or `404` for a bad id shape, an unknown id, or a
  row whose file is missing. Task 7 calls it.

**Why a route at all, when `/p/:id` already serves these bytes.** The client
cannot fetch `/p/:id` cross-origin: `server/src/app.ts`'s CORS middleware
deliberately SKIPS the publish host, commented "a published page is not a
credentialed response, and stamping the app's origin and `allow-credentials`
onto it would leak the app's CORS posture onto the anonymous host." Do not add
a CORS header there to save this route. On the API host, the existing CORS
middleware and `originGuard` already apply, and `originGuard` exempts GET.

`publishHostOnly` needs no change and must not get one: it already 404s
everything but `/health` and `GET|HEAD /p/*` on the publish host, so
`/share/:id` is unreachable there by construction. Task step 5 proves it.

- [ ] **Step 1: Write the failing tests**

Create `server/src/routes/share.test.ts`. It follows `publicPage.test.ts`'s
shape exactly, including `describe.skipIf(!url)` — these are integration tests
against a real MariaDB.

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { writePage } from '../publish/store.ts';
import { upsertPage } from '../repositories/publish.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';

const url = process.env.TEST_DATABASE_URL;
const APP_ORIGIN = 'http://localhost:5173';
const PUBLISH_ORIGIN = 'https://pub.example.com';

describe.skipIf(!url)('GET /share/:id', () => {
  let pool: Pool;
  let root: string;
  let app: ReturnType<typeof createApp>;
  let alice: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    root = await mkdtemp(join(tmpdir(), 'bear-share-'));
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');

    app = createApp({
      env: {
        appOrigin: APP_ORIGIN,
        apiOrigin: 'http://localhost:8787',
        databaseUrl: url ?? '',
        googleClientId: 'id',
        googleClientSecret: 'secret',
        pdfRendererUrl: 'http://127.0.0.1:8788',
        imageRoot: join(root, 'images'),
        publishOrigin: PUBLISH_ORIGIN,
        publishRoot: root,
      },
      query: pool.query,
      transaction: async (run) => run(pool.query),
      fetch: async () => new Response(null, { status: 502 }),
      secureCookies: false,
    });

    alice = await findOrCreateUserByIdentity(pool.query, {
      provider: 'google',
      subject: 'alice',
      email: 'alice@example.com',
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await pool?.end();
  });

  async function publish(id: string, html: string): Promise<void> {
    await writePage(root, alice, id, html);
    await upsertPage(pool.query, {
      id,
      userId: alice,
      noteId: 'note-1',
      title: 'Note',
      bytes: Buffer.byteLength(html, 'utf8'),
      publishedAt: Date.now(),
    });
  }

  it('returns the stored document', async () => {
    await publish('page1', '<!doctype html><html><body>hi</body></html>');

    const response = await app.request('/share/page1');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hi');
  });

  it('404s an unknown id', async () => {
    const response = await app.request('/share/nosuchpage');
    expect(response.status).toBe(404);
  });

  it('404s a malformed id rather than 500ing', async () => {
    // `readPage` THROWS on an unsafe shape rather than sanitising it, so
    // without a guard ahead of it this would be a 500 — which tells an
    // anonymous caller "that id was malformed" as opposed to "that id does
    // not exist". Both must answer the same 404.
    const response = await app.request('/share/..%2F..%2Fetc%2Fpasswd');
    expect(response.status).toBe(404);
  });

  it('404s a row whose file is missing', async () => {
    // A row can exist without its file: the two are not written atomically.
    await upsertPage(pool.query, {
      id: 'orphan',
      userId: alice,
      noteId: 'note-2',
      title: 'Note',
      bytes: 10,
      publishedAt: Date.now(),
    });

    const response = await app.request('/share/orphan');
    expect(response.status).toBe(404);
  });

  it('does not answer on the publish host', async () => {
    // The publish host serves the public surface and nothing else. This is
    // `publishHostOnly`'s existing behaviour, asserted here because this
    // route is new and the guarantee is what keeps it off that host.
    await publish('page2', '<!doctype html><html><body>hi</body></html>');

    const response = await app.request('/share/page2', {
      headers: { host: 'pub.example.com' },
    });

    expect(response.status).toBe(404);
  });

  it('carries the app origin in its CORS header, because the app fetches it', async () => {
    await publish('page3', '<!doctype html><html><body>hi</body></html>');

    const response = await app.request('/share/page3');

    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
TEST_DATABASE_URL=mysql://markflowing:markflowing@127.0.0.1:3308/markflowing_test \
  npx vitest run server/src/routes/share.test.ts
```

Expected: FAIL — the module does not exist. **If the run reports `skipped`
instead, the environment variable did not reach it**; a skipped suite is not a
failing one and proves nothing. Fix that before continuing.

- [ ] **Step 3: Write the route**

Create `server/src/routes/share.ts`:

```ts
import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { readPage } from '../publish/store.ts';
import { getPageOwner } from '../repositories/publish.ts';

/**
 * The only id shape a URL segment may carry.
 *
 * Checked BEFORE `getPageOwner` or `readPage` run, for the same reason
 * `publicPage.ts` checks it there: `readPage` THROWS on an unsafe shape
 * rather than sanitising it, and a thrown error would surface as a 500 —
 * telling an anonymous caller "that id was malformed" as opposed to "that id
 * does not exist". Both answer the same 404.
 */
const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The published document, served to the APP rather than to a reader.
 *
 * Same bytes as `GET /p/:id`, same capability, different host — and the host
 * is the whole reason this route exists. The app cannot fetch `/p/:id`:
 * `app.ts`'s CORS middleware deliberately skips the publish host so the app's
 * credentialed posture does not leak onto the anonymous one, and a
 * cross-origin `fetch` without `access-control-allow-origin` is blocked by
 * the browser. Adding that header to the publish host would reverse a
 * deliberate decision in order to save this file.
 *
 * Here on the API host, the existing CORS middleware and `originGuard` both
 * apply, and `originGuard` exempts GET. `publishHostOnly` already 404s
 * everything but `/health` and `GET|HEAD /p/*` on the publish host, so this
 * route is unreachable there by construction and that middleware needs no
 * change.
 *
 * No CSP: nothing renders this. The client parses it and throws the document
 * away.
 */
export function shareRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/share/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) return c.body(null, 404);

    const owner = await getPageOwner(deps.query, id);
    if (owner === null) return c.body(null, 404);

    const html = await readPage(deps.env.publishRoot, owner.userId, id);
    // A row can exist without its file: the two are not written atomically,
    // so a crash between them leaves exactly that. Same 404 as an unknown id.
    if (html === null) return c.body(null, 404);

    return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
  });

  return app;
}
```

- [ ] **Step 4: Mount it**

In `server/src/app.ts`, add the import beside the other route imports:

```ts
import { shareRoutes } from './routes/share.ts';
```

Add the rate limit immediately after the `/p/*` one (around line 151):

```ts
  // Matches `/p/*`'s limit and for the same reason: anonymous, and it reads a
  // file from disk on every call.
  app.use('/share/*', rateLimit({ limit: 120, windowMs: 60_000, key: clientIp }));
```

Add the route beside the others (around line 162):

```ts
  app.route('/', shareRoutes(deps));
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
TEST_DATABASE_URL=mysql://markflowing:markflowing@127.0.0.1:3308/markflowing_test \
  npx vitest run server/src/routes/share.test.ts
echo "exit=$?"
```

Expected: 6 passed, exit 0. **Not skipped.**

- [ ] **Step 6: Run the boundary guards**

```bash
npx vitest run scripts/serverBoundaries.test.ts server/src/app.test.ts server/src/middleware/publishHost.test.ts
```

Expected: PASS. The new route issues no SQL of its own — it calls
`getPageOwner`, which is already written and already tenancy-annotated — so
the multi-tenancy guard should be satisfied without a new annotation. If it
flags something, do not add a `tenancy-ok` comment to silence it; read what it
caught.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/share.ts server/src/routes/share.test.ts server/src/app.ts
git commit -m "feat(server): GET /share/:id serves a published page to the app

Same bytes as /p/:id, same capability, different host — and the host is why
it exists. The app cannot fetch /p/:id cross-origin: app.ts's CORS middleware
deliberately skips the publish host so the app's credentialed posture does
not leak onto the anonymous one. Adding that header there would reverse a
deliberate decision to save one file.

publishHostOnly needs no change and gets none: it already 404s everything but
/health and GET|HEAD /p/* on the publish host, so this route is unreachable
there by construction. A test asserts it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The public page offers the import

**Files:**

- Modify: `server/src/routes/publicPage.ts`
- Modify: `server/src/routes/publicPage.test.ts`

**Interfaces:**

- Consumes: `deps.env.appOrigin`, already required at boot by
  `server/src/env.ts`'s `require_`. Nothing new is added to `Env`.
- Produces: the served page contains
  `<a ... href="<appOrigin>/?import=<id>">`. Task 8's e2e clicks it.

**The ETag must move.** It is currently hashed over `readPage`'s output and
that same string is served. Injection happens between those two points, so the
hash must be taken over the INJECTED body. Getting this wrong means every
reader receives a 304 for content they do not have — a page that renders as
blank or stale with nothing in any log.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/routes/publicPage.test.ts`:

```ts
  it('offers an import link pointing at the app', async () => {
    await publish('page-import', '<!doctype html><html lang="en"><body>hi</body></html>');

    const response = await app.request('/p/page-import', { headers: PUBLISH_HOST });
    const html = await response.text();

    expect(html).toContain(`href="${APP_ORIGIN}/?import=page-import"`);
  });

  it('hashes the ETag over the SERVED body, not the stored bytes', async () => {
    // The banner is injected between reading the file and sending it. An
    // ETag over the stored bytes would 304 a reader into content they never
    // received — blank or stale, with nothing in any log.
    await publish('page-etag', '<!doctype html><html lang="en"><body>hi</body></html>');

    const first = await app.request('/p/page-etag', { headers: PUBLISH_HOST });
    const body = await first.text();
    const etag = first.headers.get('etag')!;

    expect(body).toContain('?import=page-etag');

    const second = await app.request('/p/page-etag', {
      headers: { ...PUBLISH_HOST, 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
  });

  it('writes the banner in the document’s own language', async () => {
    await publish('page-ko', '<!doctype html><html lang="ko"><body>hi</body></html>');

    const response = await app.request('/p/page-ko', { headers: PUBLISH_HOST });

    expect(await response.text()).toContain('내 메모에 추가');
  });

  it('escapes the app origin it writes into the href', async () => {
    // The origin comes from the environment, not from a user — but it is
    // still interpolated into markup, and a value with a quote in it would
    // break out of the attribute. Escaping it costs nothing and removes the
    // question.
    await publish('page-esc', '<!doctype html><html lang="en"><body>hi</body></html>');

    const response = await app.request('/p/page-esc', { headers: PUBLISH_HOST });

    expect(await response.text()).not.toContain('href="http://localhost:5173/?import=page-esc"x');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
TEST_DATABASE_URL=mysql://markflowing:markflowing@127.0.0.1:3308/markflowing_test \
  npx vitest run server/src/routes/publicPage.test.ts
```

Expected: the first three FAIL. Not skipped.

- [ ] **Step 3: Write the injection**

In `server/src/routes/publicPage.ts`, add at module scope:

```ts
/**
 * The import banner's label, in the document's own language.
 *
 * The server has no access to the app's i18n bundles — `server/` may import
 * nothing from `src/` but `src/data/types.ts` — so these two strings live
 * here. They are the only user-facing copy the server owns, and the `lang`
 * attribute the export already writes is what selects between them. A
 * document in any other language gets English, which is the same fallback
 * `src/i18n` applies.
 */
const IMPORT_LABEL: Record<string, string> = {
  en: 'Add to my notes',
  ko: '내 메모에 추가',
};

/** Attribute-safe. The origin comes from the environment, but it is still markup. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The import affordance, injected into the page rather than baked into the
 * file on disk.
 *
 * Injected because the button is a property of BEING PUBLISHED, not of the
 * document: the app's origin should not be frozen into every file written
 * before it last changed.
 *
 * A plain anchor with NO JavaScript, which is not a simplification — it is
 * the only form the page's CSP permits. `default-src 'none'` blocks every
 * script, and relaxing it on a host that serves author-authored HTML to make
 * a button work would trade the whole reason that header is there. Styling is
 * inline, which `style-src 'unsafe-inline'` already allows.
 *
 * Appended before `</body>` when there is one, and to the end otherwise: a
 * document on disk was written by this app's own exporter and always has a
 * body, but a malformed one must still serve rather than lose its banner.
 */
function withImportBanner(html: string, appOrigin: string, id: string): string {
  const lang = /<html[^>]*\blang="([^"]*)"/i.exec(html)?.[1]?.toLowerCase() ?? 'en';
  const label = IMPORT_LABEL[lang] ?? IMPORT_LABEL.en!;
  const href = `${escapeAttribute(appOrigin)}/?import=${escapeAttribute(id)}`;

  const banner =
    `<a href="${href}" style="position:fixed;right:16px;bottom:16px;z-index:2147483647;` +
    `display:inline-block;padding:12px 16px;border-radius:8px;background:#5b4bdb;color:#fff;` +
    `font:600 14px/1.2 system-ui,sans-serif;text-decoration:none">${label}</a>`;

  const close = html.lastIndexOf('</body>');
  return close === -1 ? html + banner : html.slice(0, close) + banner + html.slice(close);
}
```

- [ ] **Step 4: Use it, and move the ETag**

In the `/p/:id` handler, replace the two lines

```ts
    const etag = `"${createHash('sha256').update(html).digest('hex')}"`;
```

with

```ts
    // Injected BEFORE the hash. The ETag must describe what is sent, not what
    // is on disk — otherwise a reader holding a tag for the stored bytes gets
    // a 304 for content they never received.
    const body = withImportBanner(html, deps.env.appOrigin, id);
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
```

and the final return with

```ts
    return c.body(body, 200, { 'content-type': 'text/html; charset=utf-8' });
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
TEST_DATABASE_URL=mysql://markflowing:markflowing@127.0.0.1:3308/markflowing_test \
  npx vitest run server/src/routes/publicPage.test.ts
echo "exit=$?"
```

Expected: PASS, exit 0, not skipped.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/publicPage.ts server/src/routes/publicPage.test.ts
git commit -m "feat(server): the public page offers Add to my notes

A plain anchor with no JavaScript, which is not a simplification but the only
form the page's CSP permits — relaxing default-src 'none' on a host that
serves author-authored HTML to make a button work would trade away the whole
reason that header is there.

The ETag now hashes the SERVED body rather than the stored bytes. Injection
happens between reading the file and sending it, so hashing the file would
304 a reader into content they never received, with nothing in any log.

The banner's language comes from the document's own lang attribute. server/
may import nothing from src/ but types.ts, so these two strings live in the
route; anything else falls back to English, as src/i18n does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `parseSharedPage` — turning bytes from outside into a payload

**Files:**

- Create: `src/features/import/parseSharedPage.ts`
- Create: `src/features/import/parseSharedPage.test.ts`
- Create: `src/features/import/index.ts`

**Interfaces:**

- Consumes: the document Task 1 produces.
- Produces, for Tasks 5 and 7:

```ts
export interface SharedImage {
  /** The `files/<id>.webp` path exactly as it appears in `text`. */
  path: string;
  blob: Blob;
}

export interface SharedPayload {
  title: string;
  text: string;
  images: SharedImage[];
  /** Images whose bytes could not be read. Reported to the user, never hidden. */
  skipped: number;
}

export function parseSharedPage(html: string): SharedPayload | null;
```

**This function parses bytes from outside the app.** Every branch is a real
input, not a hypothetical. It is pure — a string in, a value out — so all of it
is cheap to test, which is the point of separating it from the fetch.

**`vitest.setup.ts` swaps the global `Blob` for Node's.** Assert on
`blob.size` / `blob.type`, never `instanceof Blob`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/import/parseSharedPage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseSharedPage } from './parseSharedPage';

/** The smallest valid document Task 1's exporter produces. */
function page(text: string, body = ''): string {
  const json = JSON.stringify({ title: 'Note', text });
  return `<!doctype html><html lang="en"><body>${body}<script type="application/json" id="bear-source">${json}</script></body></html>`;
}

describe('parseSharedPage', () => {
  it('reads the title and text', () => {
    const result = parseSharedPage(page('Note\n\nbody\n'));

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Note');
    expect(result!.text).toBe('Note\n\nbody\n');
    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(0);
  });

  it('reads an inlined image and keeps its path', () => {
    // "AAAA" base64-decodes to four bytes.
    const img =
      '<img data-src="files/abc123.webp" src="data:image/webp;base64,AAAAAA==">';
    const result = parseSharedPage(page('Note\n\n![](files/abc123.webp)\n', img));

    expect(result!.images).toHaveLength(1);
    expect(result!.images[0]!.path).toBe('files/abc123.webp');
    // Duck-typed: `vitest.setup.ts` swaps the global Blob, so `instanceof`
    // is false here even for a real one.
    expect(result!.images[0]!.blob.type).toBe('image/webp');
    expect(result!.images[0]!.blob.size).toBe(4);
  });

  it('returns null for a page published before the payload existed', () => {
    // Absence is the signal. Nothing migrates and no version marker exists.
    expect(parseSharedPage('<!doctype html><html><body>hi</body></html>')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const html =
      '<!doctype html><html><body><script type="application/json" id="bear-source">{oh no</script></body></html>';
    expect(parseSharedPage(html)).toBeNull();
  });

  it('returns null for a payload of the wrong shape', () => {
    const html =
      '<!doctype html><html><body><script type="application/json" id="bear-source">{"title":1,"text":null}</script></body></html>';
    expect(parseSharedPage(html)).toBeNull();
  });

  it('returns null for a payload past the length cap', () => {
    expect(parseSharedPage(page('x'.repeat(1_000_001)))).toBeNull();
  });

  it('counts an image it cannot read rather than dropping it silently', () => {
    // A note that quietly loses a picture is worse than one that says it did.
    const img = '<img data-src="files/abc.webp" src="https://example.com/x.webp">';
    const result = parseSharedPage(page('Note\n\n![](files/abc.webp)\n', img));

    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(1);
  });

  it('ignores an img with no data-src', () => {
    // Not an image this app stored — it is a remote URL the author wrote, and
    // it stays in the text as a remote URL. Nothing to import, nothing lost.
    const img = '<img src="data:image/webp;base64,AAAAAA==">';
    const result = parseSharedPage(page('Note\n', img));

    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(0);
  });

  it('refuses a data-src that is not a stored-image path', () => {
    // The path is written into the note's text and used to build a filename.
    // Anything that is not `files/<id>.webp` is not ours.
    const img =
      '<img data-src="../../etc/passwd" src="data:image/webp;base64,AAAAAA==">';
    const result = parseSharedPage(page('Note\n', img));

    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(1);
  });

  it('keeps one entry when the same image appears twice', () => {
    const img =
      '<img data-src="files/abc.webp" src="data:image/webp;base64,AAAAAA==">'.repeat(2);
    const result = parseSharedPage(page('Note\n', img));

    expect(result!.images).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/features/import/parseSharedPage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/import/parseSharedPage.ts`:

```ts
import { storedImageId } from '@/data';

/**
 * The longest note this will import.
 *
 * The payload is bytes from outside the app, so it is bounded before it can
 * reach IndexedDB. One million characters is far past any note a person
 * writes and far short of anything that makes the browser struggle.
 */
const MAX_TEXT = 1_000_000;

export interface SharedImage {
  /** The `files/<id>.webp` path exactly as it appears in `text`. */
  path: string;
  blob: Blob;
}

export interface SharedPayload {
  title: string;
  text: string;
  images: SharedImage[];
  /** Images whose bytes could not be read. Reported to the user, never hidden. */
  skipped: number;
}

/** `data:<mime>;base64,<payload>` — the only form the exporter writes. */
const DATA_URI = /^data:([^;,]+);base64,(.*)$/s;

function decodeDataUri(uri: string): Blob | null {
  const match = DATA_URI.exec(uri);
  if (match === null) return null;

  try {
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1]! });
  } catch {
    // `atob` throws on a payload that is not base64. A corrupt image is a
    // skipped image, never a failed import.
    return null;
  }
}

/**
 * The importable payload inside a published or exported document, or `null`.
 *
 * Pure: a string in, a value out. It owns no DOM, touches no database, and
 * makes no request — which is what lets every branch below be a cheap unit
 * test, and every branch below is a real input rather than a hypothetical.
 *
 * `null` means "this document is not importable", and the most common reason
 * is the most boring one: it was published before sub-project W shipped and
 * carries no payload at all. Absence is the signal; nothing migrates and
 * there is no version marker to check.
 *
 * An image is matched to its place in the text by `data-src`, which the
 * exporter keeps for exactly this purpose. An `<img>` without one is not an
 * image this app stored — it is a remote URL the author wrote, which stays in
 * the text as a remote URL and is not ours to import.
 *
 * An image WITH a `data-src` whose bytes cannot be read is COUNTED, not
 * dropped: `skipped` reaches the confirmation sheet, because a note that
 * quietly loses a picture is worse than one that says it did.
 */
export function parseSharedPage(html: string): SharedPayload | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const block = doc.getElementById('bear-source');
  if (block === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.textContent ?? '');
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const { title, text } = parsed as Record<string, unknown>;
  if (typeof title !== 'string' || typeof text !== 'string') return null;
  if (text.length > MAX_TEXT) return null;

  const images: SharedImage[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const element of doc.querySelectorAll('img[data-src]')) {
    const path = element.getAttribute('data-src') ?? '';
    // Anything that is not `files/<id>.webp` is not a path this app wrote,
    // and it is about to become part of a note's text.
    if (storedImageId(path) === null) {
      skipped += 1;
      continue;
    }
    if (seen.has(path)) continue;

    const blob = decodeDataUri(element.getAttribute('src') ?? '');
    if (blob === null) {
      skipped += 1;
      continue;
    }

    seen.add(path);
    images.push({ path, blob });
  }

  return { title, text, images, skipped };
}
```

Create `src/features/import/index.ts`:

```ts
export { parseSharedPage } from './parseSharedPage';
export type { SharedImage, SharedPayload } from './parseSharedPage';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/features/import/parseSharedPage.test.ts
echo "exit=$?"
```

Expected: 10 passed, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/import
git commit -m "feat(import): parseSharedPage reads a document's payload

Pure — a string in, a value out, no DOM ownership, no database, no request —
which is what makes every branch cheap to test, and every branch is a real
input rather than a hypothetical: a pre-W page with no payload, malformed
JSON, a payload of the wrong shape, one past the length cap, an image whose
bytes will not decode, a data-src that is not a stored-image path.

An image with a data-src whose bytes cannot be read is COUNTED rather than
dropped. A note that quietly loses a picture is worse than one that says so.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `importNote` — writing the copy

**Files:**

- Create: `src/data/importNote.ts`
- Create: `src/data/importNote.test.ts`
- Modify: `src/data/index.ts` — export `importNote` and its types

**Interfaces:**

- Consumes: `SharedPayload` from Task 4 — but **structurally, not by import**.
  `src/data/` must not import from `src/features/`, so this file declares the
  shape it needs.
- Produces, for Task 7:

```ts
export interface ImportableNote {
  title: string;
  text: string;
  images: { path: string; blob: Blob }[];
}

export interface ImportNoteDeps {
  createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
}

export function importNote(payload: ImportableNote, deps?: ImportNoteDeps): Promise<Note>;
```

**Why `createImageBitmap` is injected.** `files.add` requires a `FileMeta`
carrying `mime`, `width` and `height` — the dimensions let a node view reserve
the right box before the blob resolves, so a long note does not reflow once per
image. The only way to learn them from a blob is to decode it, and **jsdom
implements neither `createImageBitmap` nor `OffscreenCanvas`**. This is the
same problem `src/features/notes/downscale.ts` has, and it takes the same
answer: inject it, and let the unit tests supply a fake. Do not reach for a
`canvas` package.

**Do not touch `syncedRev`.** An earlier import path cleared it and
manufactured a `(conflict)` note on the most ordinary flow there is. `files.add`
and `notes.create` already call `markDirty`; that is the whole sync story here.

- [ ] **Step 1: Write the failing tests**

Create `src/data/importNote.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from './db';
import { importNote } from './importNote';

function blob(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/webp' });
}

const fakeBitmap = async (): Promise<{ width: number; height: number }> => ({
  width: 800,
  height: 600,
});

describe('importNote', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.notes.clear(), db.files.clear(), db.syncState.clear()]);
  });

  it('creates a note holding the imported text', async () => {
    const note = await importNote({ title: 'Shared', text: 'Shared\n\nbody\n', images: [] });

    expect(note.text).toBe('Shared\n\nbody\n');
    expect(await db.notes.get(note.id)).toBeDefined();
  });

  it('gives the note a NEW id rather than the sender’s', async () => {
    const a = await importNote({ title: 'A', text: 'A\n', images: [] });
    const b = await importNote({ title: 'A', text: 'A\n', images: [] });

    expect(a.id).not.toBe(b.id);
  });

  it('stores each image under a new id and rewrites the text to match', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: 'Shared\n\n![](files/sender-id.webp)\n',
        images: [{ path: 'files/sender-id.webp', blob: blob(4) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    // The sender's id must be gone: it is their id, and it could collide with
    // one this device already holds for entirely different bytes.
    expect(note.text).not.toContain('sender-id');

    const stored = await db.files.where('noteId').equals(note.id).toArray();
    expect(stored).toHaveLength(1);
    expect(note.text).toContain(`files/${stored[0]!.id}.webp`);
    expect(stored[0]!.width).toBe(800);
    expect(stored[0]!.height).toBe(600);
    // Duck-typed: `vitest.setup.ts` swaps the global Blob.
    expect(stored[0]!.blob.size).toBe(4);
  });

  it('rewrites every occurrence of a repeated image', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: '![](files/x.webp)\n\n![](files/x.webp)\n',
        images: [{ path: 'files/x.webp', blob: blob(4) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    expect(note.text).not.toContain('files/x.webp');
    const stored = await db.files.where('noteId').equals(note.id).toArray();
    expect(note.text.split(`files/${stored[0]!.id}.webp`)).toHaveLength(3);
  });

  it('leaves the text alone for an image it was not given', async () => {
    // The sender's device did not hold those bytes either. The reference
    // stays as written rather than being silently deleted from the note.
    const note = await importNote({
      title: 'Shared',
      text: '![](files/absent.webp)\n',
      images: [],
    });

    expect(note.text).toContain('files/absent.webp');
  });

  it('marks the note and its images dirty so a signed-in device uploads them', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: '![](files/x.webp)\n',
        images: [{ path: 'files/x.webp', blob: blob(4) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    // `SyncState` is keyed `[kind+key]` — the field is `key`, not `id`.
    const dirty = await db.syncState.toArray();
    expect(dirty.some((row) => row.kind === 'note' && row.key === note.id)).toBe(true);
    expect(dirty.filter((row) => row.kind === 'image')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/data/importNote.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/data/importNote.ts`:

```ts
import { storedImagePath } from './images';
import { files, notes } from './repositories';
import type { Note } from './types';

/**
 * A note received from somewhere else, ready to be copied in.
 *
 * Declared here rather than imported from `src/features/import/`: `src/data/`
 * must not import from `src/features/`, and the shape is small enough that
 * structural typing joins the two ends with no shared module. The same move
 * `parseTags` makes from the other direction.
 */
export interface ImportableNote {
  title: string;
  text: string;
  /** `path` is the `files/<id>.webp` reference as it appears in `text`. */
  images: { path: string; blob: Blob }[];
}

export interface ImportNoteDeps {
  /**
   * Injected, because **jsdom implements neither `createImageBitmap` nor
   * `OffscreenCanvas`** and the unit tests must supply a fake — the same
   * answer `downscale.ts` gives to the same problem.
   *
   * It is needed at all because `files.add` requires the image's real
   * dimensions: a node view reserves its box from them before the blob
   * resolves, and without them a long note reflows once per image as each one
   * lands.
   */
  createImageBitmap?: (
    blob: Blob,
  ) => Promise<{ width: number; height: number; close?: () => void }>;
}

/**
 * Copies a shared note into this device's own notes.
 *
 * A COPY in every respect that matters: a new note id, new image ids, and
 * `createdAt` of now. Nothing here reuses an identifier the sender chose —
 * their image id could collide with one this device already holds for
 * entirely different bytes, and their note id is meaningless in this
 * database.
 *
 * The text is rewritten as each image lands, so a `files/<theirs>.webp`
 * becomes `files/<ours>.webp`. An image the payload does NOT carry is left as
 * written rather than stripped: the sender's device did not hold those bytes
 * either, and deleting the reference would edit the note on their behalf.
 *
 * `notes.create` and `files.add` each call `markDirty` already, so a
 * signed-in device uploads the import on its next push with no sync work
 * here. **Nothing in this file may touch `syncedRev`** — an earlier import
 * path cleared it and manufactured a `(conflict)` note on the most ordinary
 * flow there is (`docs/rulings/sync.md`).
 *
 * The note is created FIRST and its text rewritten after, rather than the
 * text being assembled up front, because `files.add` takes the owning note's
 * id — and inventing one before `notes.create` runs would be a second source
 * of truth for it.
 */
export async function importNote(
  payload: ImportableNote,
  deps: ImportNoteDeps = {},
): Promise<Note> {
  const measure = deps.createImageBitmap ?? ((blob: Blob) => globalThis.createImageBitmap(blob));

  const note = await notes.create(payload.text);

  let text = payload.text;
  for (const image of payload.images) {
    const bitmap = await measure(image.blob);
    const record = await files.add(note.id, image.blob, {
      mime: image.blob.type,
      width: bitmap.width,
      height: bitmap.height,
    });
    bitmap.close?.();

    // `split`/`join` rather than a regex: the path comes from outside and
    // would need escaping, and every occurrence must move, not the first.
    text = text.split(image.path).join(storedImagePath(record.id));
  }

  return text === payload.text ? note : notes.save(note.id, text);
}
```

- [ ] **Step 4: Export it from the data barrel**

In `src/data/index.ts`, beside the other exports:

```ts
export { importNote } from './importNote';
export type { ImportableNote, ImportNoteDeps } from './importNote';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/data/importNote.test.ts
echo "exit=$?"
```

Expected: 6 passed, exit 0.

- [ ] **Step 6: Run the guards this touches**

```bash
npx vitest run scripts/sourceLint.test.ts src/data
```

Expected: PASS, including the import-cycle check — `importNote.ts` imports
`./repositories`, which is inside `src/data/`, so no new edge crosses a
boundary.

- [ ] **Step 7: Commit**

```bash
git add src/data/importNote.ts src/data/importNote.test.ts src/data/index.ts
git commit -m "feat(data): importNote copies a shared note into this device

A copy in every respect that matters: new note id, new image ids, createdAt
of now. Nothing reuses an identifier the sender chose — their image id could
collide with one this device holds for entirely different bytes.

An image the payload does not carry is left as written rather than stripped:
the sender's device did not hold those bytes either, and removing the
reference would edit the note on their behalf.

createImageBitmap is injected because jsdom implements neither it nor
OffscreenCanvas — the same answer downscale.ts gives to the same problem. It
is needed because files.add wants real dimensions, which is what lets a node
view reserve its box before the blob resolves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The confirmation sheet

**Files:**

- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ko.ts`
- Create: `src/features/import/ImportSheet.tsx`
- Create: `src/features/import/importSheet.test.tsx`
- Modify: `src/features/import/index.ts`

**Interfaces:**

- Consumes: `SharedPayload` from Task 4.
- Produces, for Task 7:

```ts
export interface ImportSheetProps {
  /** `null` while nothing is offered. */
  payload: SharedPayload | null;
  /** True when the fetch failed or the page carried no payload. */
  failed: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ImportSheet(props: ImportSheetProps): ReactElement | null;
```

**Read first:** `docs/rulings/accessibility.md`.

**Nothing is written before the user confirms.** This is outside data entering
their notes; it gets a confirmation for the same reason a destructive action
does.

- [ ] **Step 1: Add the strings**

In `src/i18n/en.ts`, after the `publish.*` block:

```ts
  // Sub-project W: accepting a note shared from somebody else's app.
  // `import.images` is plural-agnostic on purpose — Korean has no plural
  // agreement and English reads fine with a count in front of a bare noun
  // here ("3 images"), which is cheaper than an ICU plural rule for one
  // string nobody reads twice.
  'import.title': 'Add this note?',
  'import.body': 'This will be added to your notes as a new note you own.',
  'import.images': '{count} images',
  // `{count}` is substituted at the call site with `.replace`. `useT` is
  // `(key: TranslationKey) => string` and takes no interpolation argument —
  // every placeholder in this app works that way (`PublishDialog` does it for
  // `{limit}` and `{when}`).  Do not add a second mechanism for one string.
  'import.skipped': '{count} images could not be read and will be missing.',
  'import.confirm': 'Add to my notes',
  'import.cancel': 'Cancel',
  'import.failed': 'This note could not be added.',
```

In `src/i18n/ko.ts`, in the same position:

```ts
  'import.title': '이 메모를 추가할까요?',
  'import.body': '내 메모에 새 메모로 추가됩니다.',
  'import.images': '이미지 {count}개',
  'import.skipped': '이미지 {count}개를 읽지 못해 빠집니다.',
  'import.confirm': '내 메모에 추가',
  'import.cancel': '취소',
  'import.failed': '이 메모를 추가할 수 없습니다.',
```

Note `import.confirm` is deliberately the same sentence the server writes as
its banner label in Task 3. The two live in different places because
`server/` cannot import `src/i18n`; if one changes, change both.

- [ ] **Step 2: Write the failing tests**

Create `src/features/import/importSheet.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { ImportSheet } from './ImportSheet';
import type { SharedPayload } from './parseSharedPage';

function renderSheet(props: Partial<React.ComponentProps<typeof ImportSheet>> = {}) {
  const payload: SharedPayload = { title: 'Shared', text: 'Shared\n', images: [], skipped: 0 };
  const merged = {
    payload,
    failed: false,
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  };
  render(
    <I18nProvider>
      <ImportSheet {...merged} />
    </I18nProvider>,
  );
  return merged;
}

describe('ImportSheet', () => {
  it('renders nothing when nothing is offered', () => {
    render(
      <I18nProvider>
        <ImportSheet payload={null} failed={false} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </I18nProvider>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the note it is offering', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Add this note/);
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('says how many images are coming', () => {
    renderSheet({
      payload: {
        title: 'Shared',
        text: 'Shared\n',
        images: [
          { path: 'files/a.webp', blob: new Blob(['a']) },
          { path: 'files/b.webp', blob: new Blob(['b']) },
        ],
        skipped: 0,
      },
    });

    expect(screen.getByText('2 images')).toBeInTheDocument();
  });

  it('says so when images could not be read', () => {
    renderSheet({
      payload: { title: 'Shared', text: 'Shared\n', images: [], skipped: 3 },
    });

    expect(screen.getByText(/3 images could not be read/)).toBeInTheDocument();
  });

  it('confirms on the confirm button and not before', async () => {
    const props = renderSheet();

    expect(props.onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Add to my notes' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels on the cancel button', async () => {
    const props = renderSheet();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables confirm while the import is running', () => {
    renderSheet({ busy: true });
    expect(screen.getByRole('button', { name: 'Add to my notes' })).toBeDisabled();
  });

  it('reports a failure instead of offering an import', () => {
    renderSheet({ payload: null, failed: true });

    expect(screen.getByText('This note could not be added.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to my notes' })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/features/import/importSheet.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the component**

Create `src/features/import/ImportSheet.tsx`:

```tsx
import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

import type { SharedPayload } from './parseSharedPage';

export interface ImportSheetProps {
  /** `null` while nothing is offered. */
  payload: SharedPayload | null;
  /** True when the fetch failed or the page carried no payload. */
  failed: boolean;
  /** True while the import is writing. Confirm is disabled, never hidden. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation between a shared link and the user's own notes.
 *
 * It exists because this is OUTSIDE data entering their database — the same
 * reason a destructive action gets a confirmation, from the other direction.
 * **Nothing is written before Confirm.**
 *
 * It names the note and counts its images rather than previewing the body:
 * the reader has just come from a page rendering that body, so repeating it
 * here in a smaller box adds nothing, and a preview of author-supplied
 * Markdown inside the app's own chrome is a surface this does not need.
 *
 * `busy` disables Confirm rather than replacing the sheet with a spinner. The
 * import is a handful of IndexedDB writes; a state that flashes is worse than
 * a button that is briefly inert.
 */
export function ImportSheet({
  payload,
  failed,
  busy,
  onConfirm,
  onCancel,
}: ImportSheetProps): ReactElement | null {
  const t = useT();

  if (payload === null && !failed) return null;

  return (
    <Dialog open onClose={onCancel} label={failed ? t('import.failed') : t('import.title')}>
      <div className="flex flex-col gap-4 p-4">
        {failed || payload === null ? (
          <p className="text-ui text-text">{t('import.failed')}</p>
        ) : (
          <>
            <p className="text-ui-md font-semibold text-text">
              {payload.title === '' ? t('note.untitled') : payload.title}
            </p>
            <p className="text-ui-sm text-muted">{t('import.body')}</p>
            {payload.images.length > 0 && (
              <p className="text-ui-sm text-muted">
                {/* `useT` is `(key) => string` and takes NO interpolation
                    argument — every placeholder in this app is substituted at
                    the call site with `.replace`, as `PublishDialog` does for
                    `{limit}` and `{when}`. */}
                {t('import.images').replace('{count}', String(payload.images.length))}
              </p>
            )}
            {payload.skipped > 0 && (
              <p className="text-ui-sm text-muted">
                {t('import.skipped').replace('{count}', String(payload.skipped))}
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('import.cancel')}
          </Button>
          {!failed && payload !== null && (
            <Button onClick={onConfirm} disabled={busy}>
              {t('import.confirm')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
```

Add to `src/features/import/index.ts`:

```ts
export { ImportSheet } from './ImportSheet';
export type { ImportSheetProps } from './ImportSheet';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/features/import src/i18n
echo "exit=$?"
```

Expected: PASS, exit 0. **`Button`'s and `Dialog`'s real prop names must be
checked against their own files before writing this** — a plan's component
sketch is not a signature reference, and `variant`, `disabled` and `onClose`
are exactly the kind of guess that has been wrong here before. If a prop
differs, use the real one and say so in the commit.

- [ ] **Step 6: Commit**

```bash
git add src/features/import src/i18n
git commit -m "feat(import): the confirmation sheet

Outside data entering the user's own database gets a confirmation for the
same reason a destructive action does, from the other direction. Nothing is
written before Confirm.

It names the note and counts its images rather than previewing the body: the
reader has just come from a page rendering that body, and a preview of
author-supplied Markdown inside the app's chrome is a surface this does not
need.

import.confirm deliberately matches the banner label publicPage.ts writes.
The two live apart because server/ cannot import src/i18n; changing one means
changing both.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The import gate

**Files:**

- Create: `src/features/import/fetchSharedPage.ts`
- Create: `src/features/import/useImportGate.ts`
- Create: `src/features/import/useImportGate.test.tsx`
- Modify: `src/features/import/index.ts`
- Modify: `src/app/App.tsx`

**Interfaces:**

- Consumes: `parseSharedPage` (Task 4), `importNote` (Task 5), `ImportSheet`
  (Task 6), `API_ORIGIN` from `src/data/sync/config.ts`.
- Produces: the whole feature, reachable from a URL.

**Ordering is load-bearing.** A link recipient is by definition a first-time
visitor, so the import gate must run only once R's landing gate has closed —
otherwise the sheet opens behind the landing screen and the user meets a modal
they cannot see. `App.tsx` already branches on `gate.open`; the sheet goes in
the branch that renders `AppShell`.

**The URL is cleaned after the sheet closes**, with `history.replaceState`, so
a reload does not re-import. `?import=` is the first URL parameter this app
reads; there is no router and none should be added for it.

- [ ] **Step 1: Write the fetch helper**

Create `src/features/import/fetchSharedPage.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

Create `src/features/import/useImportGate.test.tsx`:

```tsx
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/data';
import { I18nProvider } from '@/i18n';

import { ImportGate } from './useImportGate';

function page(text: string, title = 'Shared'): string {
  const json = JSON.stringify({ title, text });
  return `<!doctype html><html lang="en"><body><script type="application/json" id="bear-source">${json}</script></body></html>`;
}

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

describe('ImportGate', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.notes.clear(), db.files.clear(), db.syncState.clear()]);
    setUrl('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing without an import parameter', () => {
    const doFetch = vi.fn();
    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    expect(doFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the note named by the parameter, writing nothing yet', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n\nbody\n')));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Shared')).toBeInTheDocument();
    // The confirmation is the point: nothing is in the database yet.
    expect(await db.notes.count()).toBe(0);
  });

  it('writes the note on confirm and clears the URL', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n\nbody\n')));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add to my notes' }));

    await waitFor(async () => expect(await db.notes.count()).toBe(1));
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('writes nothing on cancel, and still clears the URL', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n')));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await db.notes.count()).toBe(0);
    // Cleared on cancel too: otherwise a reload re-offers a note the user has
    // already declined.
    expect(window.location.search).toBe('');
  });

  it('reports a failure for a page that carries no payload', async () => {
    setUrl('?import=old');
    const doFetch = vi.fn(async () => new Response('<!doctype html><html><body>hi</body></html>'));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('This note could not be added.')).toBeInTheDocument(),
    );
    expect(await db.notes.count()).toBe(0);
  });

  it('fetches once, not once per render', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n')));

    const { rerender } = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/features/import/useImportGate.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the gate**

Create `src/features/import/useImportGate.ts`:

```tsx
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import { importNote } from '@/data';

import { fetchSharedPage } from './fetchSharedPage';
import { ImportSheet } from './ImportSheet';
import type { SharedPayload } from './parseSharedPage';

/** The query parameter a published page's import link carries. */
const PARAM = 'import';

/**
 * Removes the parameter without a navigation.
 *
 * Run on BOTH outcomes, confirm and cancel alike: left in place, a reload
 * re-offers a note the user has already dealt with — and on confirm it would
 * offer a second copy of one they already hold.
 */
function clearParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Offers the note behind `?import=<id>`, and writes it only if the user says
 * yes.
 *
 * A component rather than a bare hook so its one caller — `App.tsx` — can
 * place it by where it renders, and so the ordering that matters is visible
 * at the call site: it lives in the branch that renders `AppShell`, i.e.
 * AFTER R's landing gate has closed. A link recipient is by definition a
 * first-time visitor, so mounting this alongside the landing screen would
 * open a modal behind it.
 *
 * `?import=` is the first URL parameter this app reads. It is deliberately
 * not a route: adding a client router for one parameter would also mean a
 * Pages 404 fallback, for the same reason the landing screen is a state
 * rather than a route.
 *
 * The fetch is guarded by a ref rather than by an effect dependency. React
 * StrictMode double-mounts in development, and a second fetch of the same
 * capability is harmless but pointless; more to the point, a second SHEET
 * after the user has already answered is not.
 */
export function ImportGate({ fetch }: { fetch?: typeof globalThis.fetch } = {}): ReactElement | null {
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const id = new URL(window.location.href).searchParams.get(PARAM);
    if (id === null || id === '') return;

    started.current = true;
    let active = true;
    void fetchSharedPage(id, { fetch }).then((result) => {
      if (!active) return;
      if (result === null) setFailed(true);
      else setPayload(result);
    });

    return () => {
      active = false;
    };
  }, [fetch]);

  const close = useCallback(() => {
    clearParam();
    setPayload(null);
    setFailed(false);
    setDone(true);
  }, []);

  const confirm = useCallback(() => {
    if (payload === null) return;
    setBusy(true);
    void importNote(payload)
      .then(close)
      .catch(() => {
        setBusy(false);
        setPayload(null);
        setFailed(true);
      });
  }, [payload, close]);

  if (done && payload === null && !failed) return null;

  return (
    <ImportSheet
      payload={payload}
      failed={failed}
      busy={busy}
      onConfirm={confirm}
      onCancel={close}
    />
  );
}
```

Add to `src/features/import/index.ts`:

```ts
export { fetchSharedPage } from './fetchSharedPage';
export { ImportGate } from './useImportGate';
```

- [ ] **Step 5: Wire it into `App.tsx`**

In `src/app/App.tsx`, add the import and render `ImportGate` inside the
non-landing branch:

```tsx
import { ImportGate } from '@/features/import';
```

```tsx
          <div className="flex h-dvh flex-col">
            <UnavailableBanner />
            <div className="min-h-0 flex-1">
              <AppShell />
            </div>
            {/*
              AFTER the landing gate, deliberately. A link recipient is by
              definition a first-time visitor, so mounting this in the other
              branch would open a modal behind the landing screen.
            */}
            <ImportGate />
          </div>
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/features/import src/app
echo "exit=$?"
```

Expected: PASS, exit 0.

- [ ] **Step 7: Run the app and use it**

```bash
npm run dev
```

Open `http://localhost:5173/?import=nosuchpage` and confirm the failure
message appears. **This step is not optional.** `useSession`'s StrictMode bug
passed all six gates and was found only by running the app; this component has
the same shape — an effect with a ref guard, mounted twice in development.

- [ ] **Step 8: Commit**

```bash
git add src/features/import src/app/App.tsx
git commit -m "feat(import): the ?import= gate, end to end

A component rather than a bare hook so its ordering is visible at the call
site: it renders in App.tsx's non-landing branch, AFTER R's gate has closed.
A link recipient is by definition a first-time visitor, so mounting it
alongside the landing screen would open a modal behind it.

The parameter is cleared on both outcomes. Left in place, a reload re-offers
a note the user already declined — or, after a confirm, offers a second copy
of one they already hold.

The fetch is ref-guarded rather than dependency-guarded: StrictMode
double-mounts, and a second sheet after the user has answered is worse than a
second fetch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The round trip, and the documentation

**Files:**

- Create: `e2e/import.spec.ts`
- Modify: `CLAUDE.md` — the status table
- Modify: `docs/rulings/export.md` — trigger line and a ruling
- Modify: `docs/superpowers/NEXT.md` — the W entry

**Interfaces:**

- Consumes: everything above.
- Produces: nothing further depends on this.

**This is the only test that can catch a wrong path rewrite.** Everything
before it proves reader and writer agree with each other, which is not
evidence — the same reason `e2e/imageExport.spec.ts`'s `/usr/bin/unzip -t` is
the only thing in the repo that can see a bad CRC-32.

The recipient context needs its own `storageState` opt-out
(`{ cookies: [], origins: [] }`): every other spec relies on the shared default
that pre-dismisses the landing gate, and this test needs the gate exactly where
a real recipient finds it.

- [ ] **Step 1: Write the spec**

Create `e2e/import.spec.ts`. Publishing needs a signed-in account and a live
server, which this suite does not have — so the page is SERVED from a route
stubbed at the browser level, and the document under test is the real one
Task 1's exporter produces. What is being tested is the round trip from
exported document to stored note, which is where a path rewrite goes wrong.

```ts
import { expect, test } from '@playwright/test';

import { FIXED_NOW, type Corpus } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * A recipient is a first-time visitor, so this context opts OUT of the shared
 * `storageState` that pre-dismisses the landing gate. Without the override
 * the test would silently exercise a returning user instead — the same trap
 * the landing shot carries.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const SENDER: Corpus = {
  notes: [
    {
      id: 'sender-1',
      title: 'Shared note',
      text: 'Shared note\n\nA body.\n\n![](files/senderimg.webp)\n',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
  ],
  settings: [],
};

test('a shared document imports as a note with its image', async ({ page, context }) => {
  // The sender's side: seed a note with a real image, export it through the
  // app's own pipeline, and keep the document. This is the real exporter, not
  // a fixture — a fixture would only prove the parser matches itself.
  await seedDatabase(page, SENDER);
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();

  const document = await page.evaluate(async () => {
    const { files, notes } = await import('/src/data/index.ts');
    const blob = await (
      await fetch(
        'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
      )
    ).blob();
    const record = await files.add('sender-1', blob, {
      mime: 'image/webp',
      width: 16,
      height: 16,
    });
    const note = await notes.get('sender-1');
    const text = note!.text.replace('files/senderimg.webp', `files/${record.id}.webp`);
    await notes.save('sender-1', text);

    const { exportNote } = await import('/src/features/export/index.ts');
    const result = await exportNote({ ...note!, text }, 'html');
    return typeof result === 'string' ? result : await result.text();
  });

  expect(document).toContain('id="bear-source"');
  expect(document).toContain('data-src="files/');

  // The recipient's side: a fresh page whose `/share/<id>` answers with that
  // document.
  const recipient = await context.newPage();
  await recipient.route('**/share/page-abc', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: document }),
  );

  await recipient.goto('/?import=page-abc');

  // The landing gate first, because a recipient is a first-time visitor.
  await recipient.getByRole('button', { name: 'Get started' }).click();

  const sheet = recipient.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(recipient.getByText('1 images')).toBeVisible();

  await recipient.getByRole('button', { name: 'Add to my notes' }).click();
  await expect(sheet).toBeHidden();

  // The assertion that matters: the imported note points at an image this
  // device actually holds, under an id of its OWN, and the bytes match.
  const check = await recipient.evaluate(async () => {
    const { files, notes } = await import('/src/data/index.ts');
    const all = await notes.listActive();
    const imported = all.find((note) => note.title === 'Shared note');
    if (imported === undefined) return { ok: false, why: 'no imported note' };

    const path = /files\/([A-Za-z0-9_-]+)\.webp/.exec(imported.text);
    if (path === null) return { ok: false, why: 'no image path in the text' };

    const record = await files.get(path[1]!);
    if (record === undefined) return { ok: false, why: 'image path points at nothing' };

    return { ok: true, bytes: record.blob.size, noteId: imported.id };
  });

  expect(check.ok, check.why).toBe(true);
  expect(check.bytes).toBeGreaterThan(0);

  // The URL is cleaned, so a reload does not offer a second copy.
  expect(new URL(recipient.url()).searchParams.get('import')).toBeNull();
});
```

- [ ] **Step 2: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e -- e2e/import.spec.ts
echo "exit=$?"
```

Expected: PASS. **Kill 4173 first** — `reuseExistingServer` will otherwise
test a stale build, which has produced both a false pass and a false failure
in this repo before.

The `evaluate` blocks import from `/src/...`, which only resolves under the
dev server. If the suite runs against the preview build, replace those imports
with whatever the app exposes on `window`, or drive the sender's export
through the UI's own Export → HTML item instead. **Do not leave a test that
passes because its `evaluate` silently threw** — assert `check.ok` with its
reason attached, as written.

- [ ] **Step 3: Verify it can fail**

Temporarily change `importNote` so it does NOT rewrite the text (return `note`
unconditionally), re-run, and confirm this spec fails on
`image path points at nothing`. Restore. Confirm the restore with
`git diff --stat` before continuing — an injection that did not apply proves
nothing, and this repo has been caught by that.

- [ ] **Step 4: Update the status table**

In `CLAUDE.md`, add to the milestone table after the `V footnotes` row:

```
| W share: a published note others can add to their own notes           | complete |
```

Update the test counts in the paragraph below the table to the real numbers
from the final run.

- [ ] **Step 5: Extend the export ruling**

In `docs/rulings/export.md`, add `inlineImages` and `sourcePayload` to the
trigger line, and add this ruling:

```markdown
- **`inlineImages` must not remove `data-src`, and `renderNoteHtml` must keep
  emitting `#bear-source`.** Both look like leftovers — an attribute the
  renderer no longer needs, and a block no reader sees — and both are the
  entire import path (sub-project W). The attribute is what matches an
  inlined blob back to its `files/<id>.webp` in the note's text; without it
  the only correspondence is document order. Removing either does not fail a
  gate on the export side: the document still renders identically, and only
  `e2e/import.spec.ts` can see it.
```

- [ ] **Step 6: Record it in NEXT.md**

Add a W section to `docs/superpowers/NEXT.md` covering: why the payload rides
inside the published document rather than in a table of its own; that the
first design could not work because `app.ts` deliberately skips CORS on the
publish host; and that `createImageBitmap` is injected in `importNote` for the
same reason `downscale.ts` injects it.

- [ ] **Step 7: Run every gate**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run test:e2e
npm run build
npm run measure:check
```

`measure:check` because the sheet is a new visual surface. If it fails,
regenerate and commit — and run `measure` on `main` too before blaming this
branch.

- [ ] **Step 8: Commit**

```bash
git add e2e/import.spec.ts CLAUDE.md docs/rulings/export.md docs/superpowers/NEXT.md
git commit -m "test(import): the round trip, and the docs

Publish an exported document, import it in a fresh context with the landing
gate exactly where a real recipient finds it, and assert the imported note
points at an image this device actually holds under an id of its own. It is
the only test that can catch a wrong path rewrite — every unit test before it
proves reader and writer agree with each other, which is not evidence. Same
reason unzip -t is the only thing in the repo that can see a bad CRC-32.

The ruling added to export.md guards the two changes that look most like
leftovers and are in fact the whole feature: the data-src inlineImages used
to delete, and the payload block no reader sees. Removing either fails no
gate on the export side.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the executor

- **The controller merges this branch.** Commit on `feat/w-note-sharing` and
  do not touch `main`. If you see a merge in the reflog you did not perform,
  it was the controller.
- **Never generate synthetic load.** No busy-loops, no `yes > /dev/null`. If
  `uptime` shows a load average above 8, stop and report rather than waiting.
- **Two tasks need `TEST_DATABASE_URL`** (2 and 3). A skipped suite is not a
  passing one — if a run reports `skipped`, fix the environment before
  continuing, and never point `TEST_DATABASE_URL` at `markflowing`. The
  integration tests truncate whatever database it names.
- **Check the real signatures before writing code from this plan.** `Button`'s
  props, `Dialog`'s props, `exportNote`'s return type and `notes.listActive`'s
  shape are all used above from a reading of the source, but a plan is not a
  signature reference and this project has been burned by exactly that before.
  If one differs, use the real one and note it in the commit.
