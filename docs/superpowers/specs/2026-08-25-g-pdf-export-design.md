# G — PDF export, rendered server-side

**Date:** 2026-08-25
**Status:** specced, not started
**Supersedes:** the PDF half of M8b, and `docs/rulings/export.md`'s
"PDF is the browser's print pipeline" ruling.

## Why

M8b shipped PDF export as a call to the browser's own print pipeline: build a
standalone HTML document, put it in a hidden iframe, call `print()`. Live
testing on 2026-08-24 found four defects in the result, and the user named all
four as blocking:

1. Chrome stamps its own header and footer onto every page — a timestamp, the
   document title, the origin URL, a page number. The document looks like a
   printed web page, because that is exactly what it is.
2. Choosing "PDF" opens a system dialog. Markdown and HTML produce a file;
   PDF produces a form to fill in, with checkboxes the user has to get right.
3. Fidelity diverges from the editor, and one divergence is severe: the export
   stylesheet clears the page background under `@media print` but leaves
   `--bear-text` alone, so a note exported under a dark theme prints near-white
   text onto white paper.
4. Bear offers ten formats. We offer three.

Defect 4 shares nothing with 1–3 except a menu, and each additional format is
its own conversion problem. It is **out of scope here** and left as a separate
future sub-project. Defects 1–3 are one problem wearing three hats: all three
exist because the document is handed to Chrome's print pipeline and control is
lost at that boundary. G removes the boundary.

Defect 3's severity was reduced but not resolved on 2026-08-24 by `fd4c32f`,
which added `print-color-adjust: exact` so painted backgrounds survive the trip
to paper. That commit is not superseded — see "What `fd4c32f` still does" below.

## Decisions taken

These were settled during brainstorming and are not open in the plan.

- **The PDF is rendered on the server**, not in the browser. A client-side
  generator would mean re-implementing paged layout and subsetting Pretendard
  for Korean; the existing docblock in `exportNote.ts` argued this and was
  right. Server-side rendering also costs **zero client bundle**, which matters
  against C's measured ceiling of 324,000 B gzipped with ~9.6 kB of headroom.
- **PDF export requires a signed-in account.** The print pipeline is deleted
  rather than kept as a fallback: one path, one document, no divergence.
- **A PDF matches the app exactly**, dark page and all. A Nord export is a dark
  document. This preserves the existing "an export carries the theme you are
  looking at" ruling and resolves defect 3 by making the theme authoritative
  rather than half-stripped.
- **The renderer runs in its own container**, not inside the Hono process.
  Chromium under launchd on macOS risks the silent-hang class this repo has
  already lost a day to (`CLAUDE.md`: a launchd job could not read
  `~/Documents`, `open()` never returned, nothing logged, `KeepAlive` saw a
  healthy job). A Linux container has no TCC at all.

### The consequence that is not a side effect

**PDF export becomes the first capability that does not exist without an
account.** Sync degrades silently and the app works offline exactly as well as
it did before D2; PDF export will not. This is a change in what the app is, not
only in what it does. It is recorded here as a deliberate ruling so that nobody
later reads it as drift.

Note also that a signed-in user with no connectivity loses PDF export too.
Sign-in is not connectivity. That is an error state, specified below, not a
second design.

## Architecture

Three pieces. The seam between the first two is **forced** by
`scripts/serverBoundaries.test.ts`, which permits `server/` to import only
`src/data/types.ts` — the server cannot call `renderNoteHtml` and must not
grow its own copy.

### 1. The client still builds the document

`exportNote(note, 'pdf', locale)` calls
`renderNoteHtml(note, readExportTokens(doc.documentElement), locale)` — the
identical function HTML export already uses. One document builder means HTML
export and PDF export cannot drift.

It then POSTs the HTML to the API and hands the returned bytes to
`downloadBlob(exportFilename(note, 'pdf'), blob, doc)`.

**The filename never crosses the wire.** The client already computes it, so no
client-controlled string reaches a `Content-Disposition` header.

### 2. The Hono server is a thin authenticated pass-through

New `server/src/routes/export.ts`:

- session required (existing auth middleware)
- rate-limited **more tightly than any other route** — one render costs orders
  of magnitude more than a sync round-trip
- request body capped (2 MB) and rejected before the renderer is touched
- consults the renderer's health before forwarding
- streams `application/pdf` back

It holds no state and writes no rows, so it touches no user-scoped table and
raises no multi-tenancy question.

### 3. The renderer is a container beside MariaDB

`server/docker/pdf/` — Playwright's Chromium base image with **Pretendard and
JetBrains Mono copied from `node_modules` and `fc-cache`d in**, so the export
HTML's font-stack-by-name resolves without embedding a byte in the document.
One endpoint, `POST /render`: HTML in, PDF out.

```
context: { javaScriptEnabled: false }
page.route('**', route => route.abort())
page.setContent(html)
page.emulateMedia({ media: 'screen' })
page.pdf({ preferCSSPageSize: true, printBackground: true })
```

Four of those five lines are load-bearing and none is incidental:

- `emulateMedia({ media: 'screen' })` is what makes "matches the app exactly"
  true. `page.pdf()` applies **print** media by default, which would
  re-introduce the divergence G exists to remove.
- `preferCSSPageSize: true` keeps the existing `@page { size: A4; margin: 18mm
16mm }` the single source of page geometry, rather than duplicating it in a
  renderer option that can drift from the stylesheet.
- `printBackground: true` is the server-side equivalent of `fd4c32f`.
- `javaScriptEnabled: false` and the route abort are security controls, below.

It publishes on `127.0.0.1` like MariaDB's `3308`, keeping the tunnel the only
way in — the same ruling, for the same reason.

## Data flow

1. User chooses Export → PDF while signed in.
2. Client renders the standalone HTML from the live token cascade.
3. `POST /export/pdf`, `credentials: 'include'`, body `{ html }`.
4. Hono: authenticate → rate-limit → size-check → health-check → forward.
5. Renderer: fresh context, JS denied, all requests aborted, `setContent`,
   screen media, `pdf()`.
6. Hono streams the bytes back as `application/pdf`.
7. Client wraps them in a Blob and downloads under the locally computed name.

## Security

The threat is an authenticated user POSTing arbitrary HTML to a service driving
headless Chromium inside the network. Authentication narrows who can do this;
it does not make the content trustworthy, and the endpoint will outlive the
assumption that only one person holds an account.

Five controls, strongest first:

1. **`javaScriptEnabled: false`.** The export document contains no scripts, so
   deny the capability rather than trusting the content to lack it.
2. **`page.route('**', route => route.abort())`.** No subresource loads at all.
   This is the SSRF control: `<img src="http://192.168.1.1/">`, `<link>`,
   `@font-face url()` and `<iframe>` all die here. Fonts come from the image,
   so nothing legitimate needs the network.
3. **`setContent`, never `goto`.** No client-controlled URL, and no `file://`.
4. **The container has no route off the host.** Defence in depth for whatever
   1–3 miss.
5. **Bounded resources.** A fresh `BrowserContext` per render closed in a
   `finally`; a 10-second timeout; at most 2 concurrent renders behind a queue;
   `mem_limit` and `pids_limit` in compose as the hard stop. The browser is
   restarted every 50 renders so memory cannot creep.

The existing rate limiter's documented weaknesses carry over unchanged: it
trusts `cf-connecting-ip` verbatim and holds windows in an unbounded in-memory
`Map`. Both remain safe only while Cloudflare is the guaranteed front door and
the process is not reachable directly, which is why the renderer binds
localhost too.

## Error handling

| Condition | Status | What the user sees |
| --- | --- | --- |
| Signed out | — (never called) | PDF item disabled: "Sign in to export PDF" |
| Offline / fetch throws | — | "PDF export needs a connection" |
| Session expired | 401 | Prompt to sign in again |
| Note too large | 413 | "This note is too large to export as PDF" |
| Rate limited | 429 | "Too many exports — try again shortly" |
| Renderer down | 503 | "PDF export is unavailable right now" |
| Render timed out | 504 | as 503 |
| Anything else | 500 | the existing `export.failed` |

Six new `export.*` i18n keys in `en.ts`, with `ko.ts` translations — the
compiler enforces completeness via `Record<TranslationKey, string>`.

The disabled menu item uses **`aria-disabled`, not `disabled`**, so it stays
focusable and a keyboard user can reach it and hear why it will not work; a
`disabled` button is skipped by tab order and explains nothing.
`docs/rulings/accessibility.md` governs this and must be read before the item
is written, not after.

## What G deletes or rewrites

- `src/features/export/print.ts` and its tests — **deleted**.
- `PrintDeps`, `printHtmlDocument`, and `ExportNoteDeps.print` — deleted.
- `exportNote.ts`'s docblock argument against client-side generation — rewritten
  as an argument for server-side generation. The reasoning survives; its
  conclusion moves.
- `ExportMenu.tsx`'s `Printer` glyph → a document glyph. The comment explaining
  that a printer icon is honest because a dialog is coming becomes false, and
  goes with it.
- `html.ts`'s `@media print { html, body { background: none } }` — **removed**.
  "Matches the app exactly" makes the theme authoritative.
- `docs/rulings/export.md`'s "PDF is the browser's print pipeline" bullet —
  reversed wholesale, with the new ruling and its reasons.
- `e2e/notes.spec.ts`'s export block — the PDF assertions change shape.
- `CLAUDE.md` — the architecture summary, and the local-first paragraph, which
  must now name export as the second thing requiring the network after sync.

### What `fd4c32f` still does

`fd4c32f` added `print-color-adjust: exact` on the export stylesheet's root an
hour before this spec was written, and `printBackground: true` makes it
redundant **for the PDF path**. It is not deleted, because it still governs a
different reader entirely: someone who downloads the HTML export and prints it
from their own browser. What must change is its **stated justification** — the
comment and the test currently explain it in terms of a PDF pipeline that G
removes. Leaving that text in place would be a comment that quietly lies.

Its sibling test, "still clears the PAGE background when printing", asserts a
rule this spec deletes. That test is being changed *because a design decision
removed its subject*, not because a restyle made it inconvenient — but
`docs/rulings/testing-and-tooling.md` governs any test edited after a failure
and must be read before the edit regardless.

## Testing

### Automatable

- **Client unit:** request shaping, status→message mapping, the filename
  computed locally, `credentials: 'include'`. `fetch` injected.
- **`ExportMenu` unit:** the disabled state, its accessible name, and that it
  remains focusable.
- **Server integration** (`server/src/routes/export.test.ts`): 401
  unauthenticated, 413 over cap, 429 limited, 503 renderer unreachable, and a
  happy path returning `application/pdf` whose body starts `%PDF-`.
- **Renderer:**
  - **the SSRF guard, which is the single most important test here.** Stand up
    a local listener, POST HTML containing `<img src="http://<listener>/pwned">`,
    and assert the listener received **nothing**. Fault-inject by removing the
    route abort; it must go red.
  - JS denial: a `<script>` mutating `document.title`, asserting the title is
    unchanged.
  - the timeout: a render that hangs must 504 **and** leave the next render
    working — which is what proves no worker was pinned.
  - **the Korean font, with its trap.** The obvious assertion — extract the
    PDF's text and look for the Korean string — **cannot see tofu**: a missing
    glyph still extracts as its codepoint, so a renderer with no Korean face
    installed passes. The assertion that works parses the PDF's embedded font
    resources and requires a **Pretendard subset** to be present. That fails
    correctly when the image lacks the font, which is the real failure mode.
- **e2e:** sign in, export, assert the download starts, the file begins `%PDF-`,
  its size is plausible and it has the expected page count.

### Not automatable

Nothing in any suite can see whether the PDF **looks right** — the same wall
`npm run measure` and `npm run shots` exist for. G adds `npm run shots:pdf`:
render the fixed corpus note to PDF in four themes spanning the roster's
range — one light, one dark, `high-contrast` and `sepia` — and rasterize page 1
into `docs/design/shots/pdf/` (gitignored) for eyeball comparison. It is **not
a gate**, and like `npm run shots` its output is verified by counting files
rather than by trusting the exit code.

## Deployment

- `server/docker/pdf/Dockerfile` on Playwright's base image; Pretendard and
  JetBrains Mono copied in from `node_modules` and `fc-cache`d.
- A compose service bound to `127.0.0.1`, with `mem_limit`, `pids_limit`, a
  restart policy and a healthcheck the Hono route consults.
- `PDF_RENDERER_URL` added to `server/.env` and `server/.env.local`. The two
  cannot run at once, unchanged from D1.
- `server/README.md` updated.

**Renderer tests skip when `PDF_RENDERER_URL` is unset**, and — copying
`server/src/db/migrate.test.ts` exactly — a test asserts the variable *is* set
whenever `CI` is, so a green CI that silently rendered nothing fails loudly
instead of passing quietly.

## Risks to settle before writing code

Both belong in task one of the plan, not week two.

1. **The Playwright image must have a native `linux/arm64` variant.** If it
   resolves to `amd64` under emulation on the Mac Mini, render time goes from
   roughly a second to unusable, and that changes the whole calculus rather
   than costing a tuning pass.
2. **Disk.** The image is roughly 1.5–2 GB on a machine that also hosts the
   database and the API.

## Out of scope

- **The format roster** (TXT, RTF, DOCX, ePub, JPG, Text Bundle). Its own
  sub-project; unblocked by G and blocked by nothing in it.
- **Scope-wide or bulk export.** Already cut once in M8b for its own reasons
  (filename and archive story); unchanged here.
- **Image embedding**, which has never been scheduled and is larger than G.
