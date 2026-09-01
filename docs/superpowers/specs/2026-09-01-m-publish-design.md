# M — Publish: a public, read-only URL for one note

Written 2026-09-01, the day L5 shipped. The first capability in this app that
serves a page to somebody who has no account and never will.

## Purpose

A note that is worth writing is sometimes worth showing to one other person.
Today the only ways out are a Markdown file, an HTML file, or a PDF — all of
them attachments, all of them stale the moment they land in somebody's
downloads folder.

Publish gives one note an unguessable URL that anyone can open in a browser.
Read-only, no account on the reader's side, revocable in one click.

## What was decided, and why

Four decisions taken before any design, each of which removed a large part of
the space:

### 1. A published page is a SNAPSHOT, republished on demand

The public page is frozen until the author presses publish again.

This is not a compromise, it is the shape the repo already has. The client
builds a complete standalone HTML document today (`renderNoteHtml` — no
stylesheet link, no font host, no script, images inlined as `data:` URIs,
diagrams inlined as SVG) and POSTs it to `/export/pdf`. **Publishing posts the
same bytes to a different endpoint.** The server stores and serves them; it
never parses Markdown.

That matters because **`server/` may import only `src/data/types.ts` from
`src/`** (enforced by `scripts/serverBoundaries.test.ts`). A live-rendering
design would need the whole editor pipeline — the schema, the Markdown parser,
the highlighter, the diagram cache — reimplemented on the server or the
boundary torn down. Snapshot needs neither.

The cost is real and must be visible in the UI: an edited note keeps showing
the old version until republished. The dialog names the publish time for
exactly that reason.

### 2. Published pages are served from their own origin

`pub.markflowing.com`, routed through the existing Cloudflare tunnel to the
same process on `127.0.0.1:8787`. The DNS record and tunnel route were added
on 2026-09-01 and verified: `GET https://pub.markflowing.com/health` → 200.

**The isolation that matters is the browser's, not the process's.** Notes
preserve raw HTML deliberately (`RawHtmlBlock`), so a published document can
contain whatever the author typed — including a `<script>`. On a separate
origin that script cannot touch the app's IndexedDB, where every note lives,
and cannot reach the session cookie, which is host-only on
`api.markflowing.com`. On a shared origin it could do both.

### 3. The URL is the capability. Nothing else guards it

A published page gets a random 128-bit id. Anyone with the link reads it;
nobody can enumerate. No password, no login, no reader accounts — the public
surface stays one GET, and a small public surface is the entire security
argument.

Consequence, stated plainly: a link, once shared, is shared. Unpublishing is
the only revocation, and it is immediate.

### 4. Images stay inlined

The exported document already inlines images as `data:` URIs. Publishing keeps
that, so **one blob is the whole page**: nothing else on the public origin, no
per-image authorization table to get wrong, and no way for the page to break
because an image was later deleted. A snapshot that references live resources
is not a snapshot.

The cost is page weight — images are 2048px WebP q80, a few hundred KB each,
and base64 adds a third, so a note with five screenshots lands around 3-4 MB.
If that becomes a real problem, a public file endpoint is an additive change;
it is deliberately not in this design.

## Architecture

### The write path (app origin)

`POST /publish` — authenticated exactly as `/export/pdf` is.

- body: the rendered HTML document, `content-type: text/html`
- capped at `MAX_PUBLISH_BYTES` (20 MiB, matching `MAX_EXPORT_BYTES`) **before
  anything is written**; a cap enforced after the bytes are on disk is not a cap
- writes `PUBLISH_ROOT/<userId>/<pageId>.html` through the same
  refuse-don't-sanitise path discipline `server/src/images/store.ts` uses
- inserts or updates one row and returns `{ id, url, publishedAt }`

**Republishing an already-published note keeps its id.** A URL that changes
when you fix a typo is not a URL you can share. The client sends the note id;
the server looks for an existing row for `(user_id, note_id)` and overwrites
the blob in place.

`DELETE /publish/:id` — removes the row and the file. The URL 404s
immediately.

`GET /publish` — the account's published pages (`id`, `noteId`, `title`,
`publishedAt`, `bytes`), so the UI can show publish state. Fetched lazily when
the menu opens. **No new Dexie table and no sync interaction**: publish state
is server state, and inventing a local mirror of it would create two sources of
truth for one fact.

### The read path (publish origin)

`GET /p/:id` — no authentication, no cookie, no CORS.

| Header | Value | Why |
| --- | --- | --- |
| `content-type` | `text/html; charset=utf-8` | |
| `content-security-policy` | `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:` | The document legitimately carries inline styles and `data:` images and NOTHING else. Neutralises a `<script>` the author's raw HTML brought in, and stops the page reaching the network at all. |
| `x-content-type-options` | `nosniff` | |
| `x-robots-tag` | `noindex, nofollow` | A capability URL that has been crawled is no longer a capability. |
| `referrer-policy` | `no-referrer` | The URL is the secret; it must not leak in outbound referers. |
| `etag` | the content hash | Republishing changes it; readers get the new version without a cache purge. |

### The host split is the boundary

The tunnel points both hostnames at one process, so **the process must
distinguish them**. A middleware ahead of every route reads the `Host` header:

- on the publish host: only `GET /p/:id` and `/health` exist. Every other path
  — `/auth`, `/sync`, `/files`, `/export`, `/diagram`, `/publish` — returns 404.
- on the app host: `/p/:id` does not exist.

Verified on 2026-09-01 that without this split `pub.markflowing.com` serves the
entire API. Nothing authenticates there (the session cookie is host-only on
`api.`), but exposing the whole surface on the anonymous origin is a standing
invitation, and the OAuth callback in particular must never be reachable on a
host that could set a cookie for it.

`originGuard([appOrigin])` currently runs on `*` and would reject public page
loads. The publish host is exempt — deliberately, because a page load is a
top-level navigation rather than a cross-origin XHR, and the guard exists to
stop the latter.

### Data model — `server/migrations/004_publish.sql`

```sql
CREATE TABLE published_pages (
  id            VARCHAR(43)  NOT NULL PRIMARY KEY,
  user_id       VARCHAR(64)  NOT NULL,
  note_id       VARCHAR(64)  NOT NULL,
  title         VARCHAR(512) NOT NULL,
  bytes         INT UNSIGNED NOT NULL,
  published_at  BIGINT       NOT NULL,
  UNIQUE KEY uniq_user_note (user_id, note_id),
  KEY idx_user (user_id)
);
```

`UNIQUE (user_id, note_id)` is what makes republish idempotent and keeps one
note to one URL. `title` is denormalised so the listing needs no note read; it
is refreshed on every republish.

**Every statement against this table constrains `user_id`** except the public
read, which is keyed by the capability id alone and carries
`/* tenancy-ok: the capability id IS the authorization */`. That annotation is
required by `scripts/serverBoundaries.test.ts`'s multi-tenancy guard and the
reason must be written where the guard can see it.

### Limits

- **50 published pages per account** and **100 MB total.** Neither is a product
  position; both bound what one account can put on a personal machine's disk.
- The public GET is rate-limited by `clientIp` like every other route. The
  existing limiter trusts `cf-connecting-ip`, which is safe only while the
  tunnel is the only path in — already true and already recorded.
- Deleting an account deletes its pages and their files.

## The client

A **Publish to web** item beside Export, in the same menus that already offer
it (`ExportMenu`, and the note-row context menu). Signed out, it is
`aria-disabled` with the reason in its accessible name — the pattern PDF export
established, and the same reason: this capability does not exist without an
account.

Choosing it opens a dialog built on the existing `src/ui/Dialog.tsx`:

- the URL, with a copy button
- **when it was published** — the snapshot model is only honest if this is
  visible
- Republish, and Unpublish behind the existing `ConfirmDialog`

`src/features/publish/requestPublish.ts` mirrors `requestPdf.ts`, including its
named failure reasons: `offline`, `unauthorized`, `tooLarge`, `quotaExceeded`,
`rateLimited`, `unavailable`, `failed`. A user who is offline and a user who has
hit the page limit need different sentences.

## Failure modes

| Situation | Behaviour |
| --- | --- |
| Signed out | Menu item disabled, reason in the accessible name |
| Offline | Named failure in the dialog; nothing changes server-side |
| Document over 20 MiB | 413, and the dialog says which note is too large |
| Page or byte quota exceeded | 403 with the limit named |
| Publish succeeds, note edited afterwards | Public page keeps serving the snapshot; the dialog shows the publish time |
| Unpublished, then link opened | 404, immediately |
| Note deleted while published | The page keeps serving — the snapshot is independent by design. Unpublish is the only removal. |
| Renderer of the page contains raw `<script>` | Served, and neutralised by CSP on a foreign origin |

## Testing

- **Route tests** (in-process, no port, as `export.test.ts` does): auth, cap
  before write, republish keeping the id, delete removing both row and file,
  quota refusals, and the tenancy guard passing.
- **Host-split tests**: every app route 404s on the publish host; `/p/:id` 404s
  on the app host. This is the security boundary, so it is asserted per route,
  not once.
- **Header tests**: the CSP, `noindex` and `nosniff` values asserted BY VALUE.
- **A hostile-document test**: publish a document containing `<script>`, fetch
  it back, and assert the CSP header that neutralises it is present — the same
  discipline L5 used for its sanitizer.
- **Client tests**: `requestPublish`'s status → reason map, and the dialog's
  disabled-when-signed-out state.
- **e2e**: publish, open the URL in a second browser context with no cookies,
  assert the note's text is visible; unpublish, assert 404.
- **One real check through the tunnel**, recorded in the report: publish, then
  `curl https://pub.markflowing.com/p/<id>` from outside.

## Out of scope, deliberately

- **A public index / blog.** This publishes one note, not a site. Additive later.
- **Passwords on pages.** A real auth surface on the anonymous side, for a case
  that has not come up.
- **Live updates.** Decided in section 1; the boundary forbids the cheap version.
- **A public image endpoint.** Decided in section 4; additive if weight bites.
- **Custom domains, themes, or per-page branding.** The page ships the theme the
  author was using, because that is what the export pipeline already produces.
- **Analytics.** No counters, no logs of who read what. A capability URL plus a
  visitor log is a tracking system nobody asked for.
