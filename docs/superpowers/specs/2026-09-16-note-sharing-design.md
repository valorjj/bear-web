# Sub-project W — sharing a note, and importing it

**Date:** 2026-09-16
**Status:** design approved, plan not yet written

## The problem

The app can publish a note to a public URL (sub-project M). It cannot share
one. A reader who opens `pub.markflowing.com/p/<id>` sees a rendered document
and has no way to get it into their own notes — they can select the text and
paste it, losing every image, or they can not bother.

What the user asked for: "userA shared the notes to userB, with the link or
anything plausible. userB imports that note, userB sees the same thing."

## The constraint that shapes everything

Every table on the server is user-scoped, and
`scripts/serverBoundaries.test.ts` fails any SQL statement naming one without
a `user_id` predicate. That guard exists because one forgotten `WHERE` is a
cross-user notes leak, and it is not negotiable for a feature like this one.

So a share is **not** "userB reads userA's row". It is a capability-scoped
payload that userB **copies** into their own data. What userB ends up with is
their own note, with their own ids, which they own and can edit — and which
their own sync pushes up like any other note.

That framing also answers the questions that would otherwise be open: there is
no revocation of an imported copy (it is theirs), no live updates (it is a
copy), and no merge (there is nothing to merge into).

## Decisions taken

Four, in the order they were settled.

**1. Share extends publish rather than being a second channel.** Publishing
already mints a CSPRNG capability URL, renders the note with its images
inlined, enforces a quota and a page count, and keeps the URL stable across
republishes. A separate `shared_notes` table would duplicate all of it. The
consequence accepted: a shared note is also a page anyone holding the link can
read in a browser — which is already exactly what publishing means, and the
route already sends `x-robots-tag: noindex, nofollow`, so it is unlisted
rather than public in the searchable sense.

**2. No account is needed to import.** The recipient of a link is, far more
often than not, someone who has never used this app. Requiring a sign-in to
accept a note would make the feature useless in its most common case. The
import writes straight into IndexedDB, works in guest mode, works offline
afterwards, and — if the recipient signs in later — rides up on their next
sync push with no special handling.

**3. Every published page is importable.** No toggle, no second menu item, no
column. "I published it so people could use it" is the ordinary reason to
publish a note in a notes app, and a second state is a second thing that can
be wrong. Read-only publishing is no longer available; that is the trade.

**4. The note is imported verbatim, tags and links included.** `#work/urgent`
grafts onto the recipient's tag tree, and `[[wikilinks]]` dangle unless the
recipient happens to hold a note by that title. Stripping either would mean
userB does not see what userA shared, which is the entire request. A dangling
link already has a rendered form (`data-resolved` is false), so nothing new is
needed to display one.

## Architecture: the payload rides inside the published page

The published HTML is already the whole note with its images inlined as
`data:` URIs. Rather than storing a second copy of anything, the exported
document gains two additions, and the import reads the page it would have
rendered anyway.

**No new table. No new column. No new object on disk. No second copy of any
image.** One new route, for a reason found during spec review and recorded
under "What the server gains" below.

### What the document gains

`src/features/export/html.ts`:

- **`inlineImages` stops removing `data-src`.** It already reads
  `img[data-src]` to find each image's bytes and then deletes the attribute
  after setting `src`. Keeping it leaves
  `<img data-src="files/<uuid>.webp" src="data:image/webp;base64,…">`, and
  that one attribute is the whole mechanism by which an importer matches an
  inlined blob back to its path in the Markdown. Without it the only
  correspondence is document order, which is true but fragile.

- **`renderNoteHtml` appends a payload block** inside `<body>`, after
  `renderNoteBody(...)`:

  ```
  <script type="application/json" id="bear-source">{"title":…,"text":…}</script>
  ```

  `note.title` and `note.text` are both already on `RenderableNote`, so
  nothing new is threaded through.

  The existing CSP is `default-src 'none'; img-src data:; style-src
'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none';
frame-ancestors 'none'`. It blocks script **execution**; a
  `type="application/json"` block is never executed by any browser and is
  inert data in the DOM. **No CSP change is needed, and none should be made.**

  Two escaping hazards, both already recorded elsewhere in this repo and both
  live here:

  - The JSON must have `</script>` escaped (`<\/script>`) or a note whose text
    contains that literal terminates the block early.
  - `renderNoteHtml`'s body is ONE template literal. A backtick written into
    the new code — including into a comment beside it — terminates it, and the
    resulting parse error points at the prose rather than at the backtick,
    failing ten unrelated test files at once because the module is widely
    imported. See the toolchain-surprises entry in `CLAUDE.md`.

This affects the plain HTML export too: a downloaded `.html` will also carry
`#bear-source` and keep its `data-src` attributes. That is harmless, and
arguably right — it makes a downloaded file importable as well — but
`docs/rulings/export.md` must be read before the diff, since it is the trigger
file for every one of these symbols.

### What the server gains

`server/src/routes/publicPage.ts` injects an import banner into the HTML it
serves:

```html
<a href="${APP_ORIGIN}/?import=<id>">Add to my notes</a>
```

A plain anchor, no JavaScript — which is the only form `default-src 'none'`
permits, and is also simply enough. Styled inline, which `style-src
'unsafe-inline'` already allows.

**The ETag must move.** It is currently hashed over `readPage`'s output and
that same string is served. Injection happens between those two points, so the
hash must be taken over the injected body or every reader gets a 304 for
content they do not have.

`APP_ORIGIN` is already required at boot by `server/src/env.ts`'s `require_`
and is already used as the app's CORS origin, so nothing new is needed there.

Injection is server-side rather than baked into the stored file on purpose:
the button is a property of *being published*, not of the document, and the
app's origin should not be frozen into files on disk.

#### The one new route, and why the obvious design was wrong

The first draft of this design had the client fetch
`${PUBLISH_ORIGIN}/p/<id>` directly and parse it. **That cannot work**, and
the reason is a deliberate decision already in the code:
`server/src/app.ts`'s CORS middleware SKIPS the publish host, commented
"a published page is not a credentialed response, and stamping the app's
origin and `allow-credentials` onto it would leak the app's CORS posture onto
the anonymous host." A cross-origin `fetch` from `markflowing.com` to
`pub.markflowing.com` is therefore blocked by the browser, and adding the
header to make it work would reverse a ruling in order to save one route.

Instead: **`GET /share/:id` on the API host**, anonymous, returning the same
stored HTML `readPage` already yields.

- It is on `api.markflowing.com`, where the existing CORS middleware and
  `originGuard([appOrigin])` already apply, so the app is the only caller and
  nothing new is configured.
- It needs no CSP, because nothing renders it — the client parses it.
- `publishHostOnly` fails closed and already 404s everything but `GET`/`HEAD
/p/*` and `/health` on the publish host, so this route is unreachable there
  by construction and no change to that middleware is needed.
- It is the same capability. Holding the id already grants the rendered page;
  it now also grants the source the page was rendered from, which is the same
  information in a different shape.
- It needs a rate limit keyed on IP, like `/auth/*`: it is anonymous, and it
  reads a file from disk on every call.

The publish host and its carefully-reasoned posture are left exactly as they
are.

### What the client gains

A new `src/features/import/`:

- **`parseSharedPage(html: string)`** → `{ title, text, images: Map<string,
Blob> }` or `null`. Pure: takes a string, returns a value, owns no DOM and
  touches no database. Everything that can go wrong with bytes from outside
  goes wrong here, where it is cheap to test.

- **`useImportGate()`** — reads `?import=<id>` once at boot, fetches
  `${API_ORIGIN}/share/<id>`, opens the sheet. It must run **after** R's
  landing gate resolves: a link recipient is by definition a first-time
  visitor, so without that ordering the sheet opens behind the landing screen.

- **`ImportSheet`** — title, image count, Cancel / Add. **Nothing is written
  before Add.** This is outside data entering the user's notes; it gets a
  confirmation for the same reason a destructive action does.

- **`importNote(payload)`** in `src/data/` — `notes.create(text)`, then
  `files.add(note.id, blob, meta)` per image, rewriting each
  `files/<old>.webp` in the text to `files/<new>.webp`.
  `FilesRepository.add` already generates a fresh id and calls `markDirty`, so
  the imported copy uploads and syncs with no new sync work at all. It lives
  in `src/data/` rather than in the feature because it writes through the
  repositories and components reach persistence only through
  `src/data/index.ts`.

After the sheet closes, `history.replaceState` clears the query parameter, so
a reload does not re-import. `?import=` would be the first URL parameter this
app reads; there is no router, and none should be added for it.

## Data flow

1. userA publishes. The document now carries `#bear-source` and its
   `data-src` attributes; nothing else about publishing changes.
2. userA sends the URL by whatever means they like. There is no in-app
   recipient concept.
3. userB opens `pub.markflowing.com/p/<id>`, reads the note, taps **Add to my
   notes**.
4. The browser lands on `markflowing.com/?import=<id>`. The app boots, the
   landing gate resolves, and the import gate fetches
   `api.markflowing.com/share/<id>` — the same bytes the page was rendered
   from, over the same capability — and parses them.
5. The sheet names the note and its image count. userB confirms.
6. A new note and new file records are written locally with new ids.
   `markDirty` queues them.
7. Signed out, that is the end of it and the note is simply theirs. Signed in,
   the next push carries it up.

## Failure cases

Each of these is a silent failure if unhandled, which is why each gets a test
rather than a comment.

- **A page published before this ships has no `#bear-source`.**
  `parseSharedPage` returns `null`; the screen says the note cannot be
  imported. Republishing fixes it. Nothing migrates, and no version marker is
  needed — absence is the signal.
- **An `img[data-src]` whose `src` is not a `data:` URI.** Skip that image,
  keep the note, and report how many were skipped. A note that silently loses
  a picture is worse than one that says it did.
- **A malformed or hostile `#bear-source`.** It is outside data. Parsed,
  shape-checked, and `text` length-capped before anything reaches IndexedDB.
- **A fetch that fails, or a 404 from an unpublished note.** One message, no
  half-written note.
- **Importing the same link twice makes two notes, deliberately.**
  Deduplicating would mean recording provenance the recipient never asked for
  and cannot remove.
- **A note whose images exceed what the device will hold.** The existing image
  quota meter (L1) already covers the local side; the import surfaces the same
  refusal rather than inventing a second one.

## Testing

- `parseSharedPage` is pure and unit-tested against fixtures: a good page, a
  pre-ship page with no payload, a payload with `</script>` in the text, a
  non-`data:` image, malformed JSON, and a payload of the wrong shape.
- `importNote` is unit-tested with fake blobs. **`vitest.setup.ts` swaps the
  global `Blob` for Node's**, so these tests must duck-type and must never use
  `instanceof Blob`. This feature walks straight into a trap already recorded
  in `CLAUDE.md`.
- `publicPage.ts`'s injection is tested server-side, including that the ETag
  is computed over the served body: hash the response, request again with that
  `If-None-Match`, expect 304.
- `GET /share/:id` is tested for the 404s it shares with `/p/:id` (bad id
  shape, unknown id, row without file — all three the same 404, never a 500),
  and `serverBoundaries.test.ts`'s publish-host assertions are extended to
  prove it does NOT answer on the publish host.
- **One e2e round trip**, and it is the only thing that can catch a wrong path
  rewrite: publish a note carrying a real image, open the URL in a fresh
  context with cleared storage, import, and assert the imported note's image
  bytes equal the original's. The fresh context needs its own `storageState`
  opt-out (`{ cookies: [], origins: [] }`) — every other spec relies on the
  shared default that pre-dismisses the landing gate, and this test needs the
  gate to be exactly where a real recipient finds it. Same shape as the
  landing shot's override, and the same reason.

That round trip matters for the reason `e2e/imageExport.spec.ts`'s
`unzip -t` matters: reader and writer sharing a misunderstanding is not
evidence of anything, and only a path from one end to the other can see it.

## Explicitly out of scope

- Sharing to a named account, an inbox, or a "Shared with me" list. That needs
  account lookup by email, which is a new way to probe who has an account.
- Live updates to an imported copy.
- Sharing more than one note at once, or a tag's worth of notes.
- Read-only publishing. Decision 3 removes it.

## Storage arithmetic, flagged rather than buried

The note's text is now stored twice in the same file: once as rendered HTML,
once as JSON. For a text-only note that roughly doubles its charge, against a
base of kilobytes. Against an image-bearing note it is noise. The 100 MB
`PUBLISH_QUOTA_BYTES` and the 50-page `MAX_PUBLISHED_PAGES` do not need
raising — but `published_pages.bytes` now counts something it did not before,
and that is worth knowing when the number is next read.

## Rulings to read before writing the diff

- `docs/rulings/export.md` — the trigger file for `html.ts`,
  `renderNoteHtml`, `inlineImages`, `requestPublish.ts`, `publish.ts` and
  `publicPage.ts`. Every symbol this design touches on the export side is
  named in its trigger line.
- `docs/rulings/sync.md` — `markDirty`, and what an import must not do to
  `syncedRev`. An earlier import path reset it to 0 and manufactured a
  `(conflict)` note on the most ordinary flow there is.
- `docs/rulings/accessibility.md` — the sheet's roles and its accessible
  names.
- `docs/rulings/markdown-and-schema.md` — the import inserts Markdown, and
  typing Markdown does not parse it. The import writes note **text**, which
  the editor parses on open, so this is the safe path — but it is the same
  neighbourhood as the trap.
