# L5 — Mermaid diagrams, rendered on the server

Written 2026-08-31, the same day L3 and L4 shipped. The fifth of the L-series,
and the first feature in this app whose implementation is chosen by a
measurement that disqualifies the obvious approach outright.

## Purpose

A developer's notes contain architecture, state machines and sequences. Today
they contain them as prose, or as a screenshot of a diagram drawn somewhere
else — which does not sync as text, does not search, and does not survive the
tool that drew it.

L5 makes ` ```mermaid ` a diagram. Nothing else about the note changes: the
Markdown is still a fenced code block, so the file stays portable to GitHub,
Obsidian and anything else that renders Mermaid, and a note authored here
opens correctly in all of them.

## The measurement that decides the architecture

Spiked on a throwaway branch on 2026-08-31 and fully reverted:

- **One simple flowchart costs 208 KB gzipped across 27 requests**, against a
  whole-app eager payload of ~343 KB. That is 61% of the application, for one
  diagram.
- **All diagram types together are 947 KB across 94 chunks.** Eager is
  disqualified outright.
- **111 packages / 84 MB** land in `node_modules`.

Lazy-loading works cleanly — the main bundle does not move — so "put it behind
`React.lazy`" is technically available. It is still refused: a reader who
opens a note containing one diagram would download two thirds of an
application again, on a phone, to see a five-box flowchart. The app's first
two adjectives are *lightweight* and *fast*.

**The eager-JS ceiling was frozen at 346,500 B on 2026-08-31, immediately
before this spec** (`docs/rulings/testing-and-tooling.md`). L5 is the first
sub-project designed under it, and it is the shape that ruling names as the
second way out: move the work to the server.

## What makes this cheap here, specifically

Three things already exist and are reused whole:

- **A containerised Chromium** (`server/pdf/`, sub-project G) with fonts
  verified at image-build time, a bounded queue, a wall-clock render deadline,
  and egress denied two ways (`--host-resolver-rules=MAP * ~NOTFOUND` plus a
  per-page route abort).
- **An authenticated pass-through in front of it** (`server/src/routes/export.ts`),
  which caps the body before forwarding and maps the renderer's statuses to
  the client's.
- **A content-addressed client cache pattern** (K1's `files` store), including
  the id-shape guard and the "an id names ONE immutable artifact" discipline.

The renderer image installs its dependencies with `npm install --no-save`
inside the Dockerfile, exactly as it already does for `playwright@1.62.1`. So
**Mermaid's 84 MB never enters the host's `node_modules` and cannot reach the
bundle at all** — that exclusion is structural, not a rule someone has to
remember.

## Decisions taken

### 1. Rendered once, cached forever, keyed by content

The client hashes the diagram source, looks it up in a new Dexie store, and
renders through the server only on a miss. An unchanged diagram never
re-renders; an edited one renders once; a diagram arriving by sync renders
once on the second device.

Cache key is `sha-256(RENDER_VERSION + '\n' + source)` via Web Crypto — no new
dependency. `RENDER_VERSION` is a constant bumped whenever the Mermaid version
or the theme CSS changes, so a renderer upgrade invalidates every entry
without a migration.

The store is **derived data**: not synced, not in `BackupBundle`, safe to
delete at any time. It rebuilds from the source, which already syncs.
Eviction is LRU against a **2 MB** total, which at a few KB per SVG is
hundreds of diagrams.

### 2. The source is the editor; the diagram is what you see when you leave

No new node type. ` ```mermaid ` is a code block with a language, which
sub-project C already supports — and an *unknown* fence already round-trips
today, because `codeLanguages.ts` carries an echo row for exactly that case.

A node view on `codeBlock` keyed on `language === 'mermaid'` shows:

- the highlighted source, whenever the caret is inside the block;
- the cached SVG, whenever it is not.

One block, one surface, no layout that jumps while typing, and it degrades to
an ordinary code block when nothing is cached. `CODE_LANGUAGES` is **not**
extended — that array drives lowlight registration and adding a non-grammar to
it would ask highlight.js for a language that does not exist. Mermaid is
appended to the language picker's *choices* separately, as a diagram entry
with no lowlight registration.

### 3. One render serves all sixteen themes

Mermaid's `themeCSS` is appended verbatim into the SVG's own `<style>` and is
not processed by its colour maths, so it can carry `var(--bear-*)` references.
CSS beats presentation attributes, so those rules win over the palette Mermaid
inlines. The SVG is **inlined in the DOM**, custom properties resolve against
the page, and a live theme switch re-colours a cached diagram with no
re-render.

**Stated honestly:** Mermaid's class names differ per diagram type, so one
`themeCSS` cannot cover every type. L5 commits to a **themed set** —
flowchart, sequence, state, class, ER and pie — verified by screenshot in a
light and a dark theme. Every other type still renders; it keeps Mermaid's own
base palette, which is legible but does not belong to the theme. Growing the
themed set is a later, additive change.

Fonts work because the container bakes in Pretendard and JetBrains Mono — the
same families the app requests by name — so the label boxes Mermaid measures
in the container match what the client draws. This is the one place where a
font mismatch would silently clip text, which is why the verification is a
raster, not an assertion.

### 4. Sanitized in the container, before it leaves

Inlining SVG into the notes app means the SVG is script-capable. It is
sanitized **once, server-side**, in the page where the real DOM is (a regex
over markup is not a sanitizer):

- no `<script>`, no `<foreignObject>`, no `<use>` with an external target;
- no `on*` attribute;
- no `href` / `xlink:href` that is not a same-document `#fragment`;
- no `style` containing `url(`, `@import`, or `expression(`.

Mermaid runs with `securityLevel: 'strict'` and `htmlLabels: false`, so labels
are real `<text>` and survive that strip.

Then, in Node, a **cheap independent assertion** over the returned string for
the same forbidden constructs. If it fires, the response is a 500 and nothing
is cached: the two checks are written against the same list but run in
different places, so a sanitizer that silently stops working cannot ship a
live one past it. The client additionally refuses to inline an SVG containing
`<script`, which means a compromised or mis-deployed renderer still cannot
inject into the notes app.

### 5. A diagram needs an account; a note never does

This follows from server rendering, and it is the second capability after PDF
export that does not exist signed out. The block simply shows its source, with
a quiet retry affordance and a named reason — never a blank space, never a
spinner that does not end. Everything else about the note works offline
exactly as before, including a diagram that has already been rendered once.

## The interfaces

### `POST /render/mermaid` — the container

Body `application/json`: `{ "source": string }`. **JSON deliberately, not
`text/plain`**: `text/plain` is a CORS-safelisted content type, so accepting it
would let any page the user happens to be browsing POST straight at the
renderer on 127.0.0.1, going around the API's auth and rate limiter — the
exact reasoning that made `/render` demand `text/html`.

| Status | Meaning |
| --- | --- |
| 200 `image/svg+xml` | sanitized SVG |
| 415 | wrong content type |
| 413 | source over 20 KB |
| 422 `application/json` | Mermaid parse error, with its message |
| 503 | queue full, or too many in flight |
| 504 | render deadline exceeded |
| 500 | anything else, including a failed post-sanitize assertion |

**A syntax error is not a failure of this service.** It is the single most
likely outcome of a user typing a diagram, it is not retryable, and it carries
information the user needs — so it gets its own status and its message
reaches the block.

Limits, and why these numbers: **20 KB** of source, because a diagram is not a
document (the PDF route's 20 MB is a rendered document with inlined images);
**5 s** wall-clock deadline against `/render`'s 10 s, because a Mermaid render
is ~100 ms and five seconds is already pathological; **its own queue instance**
with `maxConcurrent: 2`, so a diagram never waits behind a PDF export. The two
queues share one Chromium — contexts are cheap, and the every-50-renders
restart remains shared, which is correct because the memory it bounds is the
browser's.

### `POST /diagram` — the API

Authenticated exactly as `/export/pdf` is, body capped **before** the forward,
503/504/422 passed through, everything else collapsed to 502. Rate-limited
with the rest of the API. It stores nothing and touches no quota: the render
is transient, the cache is the client's.

### `requestDiagram` — the client

Modelled on `requestPdf.ts`, including its named failure reasons — a user who
is offline, signed out, rate-limited or holding a syntax error needs four
different sentences, and one "diagram failed" tells none of them anything. A
thrown fetch is `offline`, not a generic failure. `invalidSyntax` carries the
parser's message.

### `diagrams` — the store

Dexie **version 6**, `diagrams: 'hash, lastUsed'`, record
`{ hash, svg, bytes, lastUsed }`. No `.upgrade()` hook: an absent row means
"not rendered yet", which is exactly right.

**`e2e/fixtures/seed.ts` must move to IndexedDB version 60 in the same
commit.** Dexie multiplies declared versions by ten; the seeding connection
otherwise blocks the upgrade forever and the app boots to a bare
`<div id="root">` with no error at all.

### Export

`html.ts` gains `replaceMermaidBlocks`, mirroring `highlightCodeBlocks`: every
`pre > code.language-mermaid` is replaced by its cached SVG. `exportNote`
renders any uncached diagram first, so a PDF never ships a fenced block where
a diagram belongs. PDF export then needs no change at all — the renderer is
handed the same document.

If a diagram cannot be rendered at export time (offline, or a syntax error),
the fence is exported verbatim rather than failing the export. An export that
refuses to run is worse than an export carrying one code block.

## Accessibility

The inlined `<svg>` carries `role="img"` and an accessible name. Mermaid's own
`accTitle` / `accDescr` directives are honoured when the source has them; when
it does not, the name is a translated pattern over the diagram's declared type
and first line. The source stays reachable — moving the caret in shows it, and
that is a keyboard-reachable path, not a hover.

`docs/rulings/accessibility.md` governs; the assertion is on the accessible
name's **value**, never its presence.

## Testing

Fault injection is required for anything below marked **(FI)** — this
sub-project's own predecessor found two of its three worst defects in tests
rather than code, both of which looked like coverage.

- **Sanitizer (FI)** — hostile inputs one per case: `<script>`, `onload=`,
  `<foreignObject>`, `xlink:href="https://…"`, `style="background:url(…)"`.
  Each must be demonstrated failing against a sanitizer with that rule
  removed. A test that passes against the disabled rule is testing nothing.
- **The Node-side assertion (FI)** — proven by returning unsanitized markup
  from an injected render and asserting a 500 with nothing cached.
- **Container route contract** — 415 / 413 / 422 / 503 / 504, with the render
  injected, as `server/pdf/server.test.ts` already does.
- **API route** — auth, cap-before-forward, status mapping, as
  `server/src/routes/export.test.ts` already does.
- **Cache** — hashing, `RENDER_VERSION` invalidation, LRU eviction by bytes.
  Asserted on **which entries survive**, not on "eviction was called".
- **Node view (jsdom)** — cached hit inlines the SVG; a miss while offline
  shows the source and names the reason; an SVG containing `<script` is
  refused. No layout needed: the SVG is markup.
- **Export** — a cached diagram becomes an SVG in the exported HTML; an
  uncached one exports as a fence.
- **e2e** — `e2e/diagram.spec.ts` with the render intercepted: the cached-hit
  path, the offline-miss path, and **a theme switch that issues no second
  request** (the claim in decision 3, asserted rather than assumed).
- **A real container render** — `npm run shots:mermaid`, alongside
  `shots:pdf`: the themed set rendered through the real image in one light and
  one dark theme, rasterised to `docs/design/shots/mermaid/`. It **skips
  silently** without `PDF_RENDERER_URL`, so **count the files; do not trust
  the exit code**. This is the only thing that can see a clipped label or an
  unthemed diagram type — nothing in the test suite can see "renders wrong".

**Bundle:** measured on both sides against the frozen 346,500. Expected cost is
a hash, a Dexie table, a node view and ~10 i18n strings. If it does not fit,
the ruling applies to L5 like anything else — it does not get a raise for
being the feature that argued for the ceiling.

## Rulings this touches

Read before writing the diff, per `CLAUDE.md`'s index:

- `markdown-and-schema.md` — a new extension and a `codeBlock` node view.
- `tag-index-and-startup.md` — `db.version(6)`, and the seed fixture with it.
- `export.md` — `html.ts`, `exportNote`, the `export.*` keys.
- `accessibility.md` — the accessible name, asserted by value.
- `testing-and-tooling.md` — the frozen ceiling; the on-demand shots harness.
- `sync.md` — by exclusion: `diagrams` is derived and must never enter
  `BackupBundle` or `syncState`.

## Out of scope, deliberately

- **A diagram picker, palette or WYSIWYG editor.** That is the second
  authoring surface `NEXT.md` names as what turns a feature into a product.
- **Server-side caching of renders.** The client cache makes repeats rare; a
  disk cache in the container is a later, purely additive change if the queue
  ever shows pressure.
- **Syncing rendered SVGs.** Decided against: it would push a second asset
  kind through K2's pipeline and interact with the image quota, to save a
  render the server does cheaply.
- **Theming every diagram type.** The themed set is named above; the rest
  render in Mermaid's base palette.
- **Client-side rendering as a fallback.** 208 KB for one flowchart. There is
  no fallback; there is a cache.
