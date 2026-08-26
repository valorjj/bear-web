# K1 — Image capture and display, locally

**Status:** specced, not started. 2026-08-26.
**Parent:** K (Image storage), the first of four sub-projects. K2–K4 are named
at the end and are explicitly NOT in scope here.

## Why this exists

"Lightweight, fast, beautiful, easy to use, **with image storage**" is this
project's stated goal, and image storage is the one clause never scheduled —
not by a milestone, not by any of the sub-projects. CLAUDE.md has carried it as
an open decision rather than a ruling since M0.

Today a note can only *mention* an image. `RawImage` renders `![alt](url)` as
its own muted monospace source, deliberately, and nothing in the app can store
a byte of image data — except that `src/data/repositories/files.ts` and the
`files` table have existed since M1, complete with `add` / `get` /
`listForNote` / `remove` / `removeForNote`, wired to nothing at all.

K1 makes pasting a screenshot into a note work, on one device, entirely
offline.

## Decisions already taken

Settled in conversation on 2026-08-26; recorded so the spec argues from them
rather than reopening them.

| Decision | Choice |
| --- | --- |
| Where bytes live | **Local first**, IndexedDB; the Mac Mini is a sync target (K2) |
| Markdown reference | **`![alt](files/<id>.webp)`** — a relative path |
| Originals | **Not kept.** One downscaled WebP per image |
| Display size | **Fits the column** by default; drag-to-resize is K3 |
| Remote URLs | **Still render as monospace source**, unchanged |
| First step | **K1 ships alone**, before the server work |

## Goal

Paste or drop an image into a note and see it, immediately, offline, with the
note's Markdown still being Markdown.

**Done means:** a screenshot pasted into a note appears in the editor at column
width; it survives a reload; the note's text is `![](files/<id>.webp)`; the
blob is in IndexedDB; and none of it needs a network.

## Non-goals

- Any server, upload, or cross-device visibility (**K2**). A note synced
  before its image exists on the receiving device shows a placeholder, not a
  broken box — that placeholder is in scope here; the transfer is not.
- Drag-to-resize, and images in Markdown / HTML / PDF export (**K3**).
- Rewiring the note-list thumbnail to read stored files (**K4**).
- **Rendering remote image URLs.** Chosen deliberately, not deferred for
  effort: a note that fetches from a third-party host the moment it opens
  turns a pasted tracking pixel into a beacon and spends the phone's data
  without being asked. Today's behaviour — remote URLs as monospace source —
  is a privacy property nobody chose on purpose but which is real, and
  changing it should be its own decision with its own setting.

## The pipeline

```
paste / drop
  ├─ reject > 25 MB                      → a message, no insert
  ├─ reject a non-image MIME             → fall through to the default paste
  ├─ downscale to ≤ 2048px on the long edge, re-encode WebP q80
  ├─ files.add(noteId, blob, 'image/webp')
  ├─ insert `![](files/<id>.webp)` at the caret
  └─ NodeView resolves `files/<id>` → object URL, revoked when the last
     consumer unmounts
```

**25 MB is a guard against a mis-paste, not a storage budget.** The downscale
runs after it, and a Retina screenshot at 2048px/WebP q80 typically lands at
200–600 KB. The Mac Mini has 188 GB free; scarcity is not the constraint.

**Downscaling happens in the browser, on a `<canvas>`.** No dependency: it is
`createImageBitmap` → `OffscreenCanvas` (or a detached `<canvas>` where that is
unavailable) → `convertToBlob({ type: 'image/webp', quality: 0.8 })`. An image
already under the limit is still re-encoded, so exactly one format is ever
stored and every downstream path has one case to handle.

## The Markdown contract

The note's text holds **`![alt](files/<id>.webp)`** — a relative path, not a
`bear://` scheme and not an absolute URL.

Three properties follow, and each is why:

- **Device-independent.** Sync (D2) moves note text verbatim; a relative path
  means nothing has to be rewritten on the way in or out.
- **Portable by construction.** Exported as a folder — the note beside a
  `files/` directory — it is a Markdown bundle that opens in Obsidian or any
  editor, with no bear-web-specific syntax to strip. That export is K3's, but
  the format decision is made here because it is the thing that cannot be
  changed later without rewriting every note.
- **Still Markdown.** A reader who has never seen this app sees an image
  reference, not a token.

`<id>` is `newId()`, the same generator the rest of the data layer uses.

## The editor

**A new Tiptap node, `StoredImage`, replacing `RawImage` for paths matching
`files/<id>.webp` only.** `RawImage` stays and keeps handling every other
destination, so remote URLs behave exactly as they do today. The two are
distinguished at parse time by the destination, not by a separate token.

- `parseMarkdown` maps an `image` token whose href matches the stored-file
  shape to `StoredImage`; everything else continues to `RawImage`.
- `renderMarkdown` writes `![alt](files/<id>.webp)` back, verbatim. **The
  round trip must be byte-identical** — `markdown-and-schema.md` requires it,
  and the `CANONICAL` fixtures are where a new case belongs.
- A **NodeView** renders the `<img>`, because the src is not in the document:
  it is resolved asynchronously from IndexedDB.

**Blob URL lifecycle is the part that will leak if it is done casually.** One
object URL per file id, cached in a module-scope `Map<id, string>` with a
reference count, revoked when the count reaches zero. Creating one per render
is the obvious implementation and is wrong: a note scrolled through on a phone
would accumulate them for the life of the tab, and nothing would report it.

**Three states, all of which happen:**

| State | Rendered |
| --- | --- |
| Resolving | a fixed-ratio placeholder, so the text does not reflow when it lands |
| Missing | a quiet "image not on this device yet" box — K2's case, and the reason it is not an error |
| Broken | the same box; a corrupt blob is not distinguishable to a user from a missing one |

A missing file is **not** an error state. After K2 it is the ordinary
appearance of an image whose bytes have not arrived, and building it as an
error now would mean rebuilding it then.

## Reclamation

**`notes.purge` already deletes a note's files** — `db.files.where('noteId')
.equals(id).delete()` is in its transaction alongside `noteTags` and
`noteFolds`, and has been since M1. So the whole-note case is covered.

**The gap is narrower and real: an image deleted from a living note's text.**
The row stays, referenced by nothing, forever. K1 closes it on save: after
`notes.save` writes new text, the ids still referenced by that text are
compared against `files.listForNote(id)` and the difference is removed.

Two constraints on that sweep, both learned from `notes-lifecycle.md`:

- It runs **inside the save transaction**, from the text being written — never
  from a `useLiveQuery` value. A cache that lags the database would delete a
  file the user just added. That ruling was bought by `useTagTree.reveal`.
- **Undo has to survive it.** Deleting an image and pressing Cmd-Z must bring
  it back. The sweep therefore hangs off `notes.save`, which `useAutosave`
  already debounces — it is not a second timer, and it must not be moved to
  fire per keystroke. This is the one place
  in K1 where a wrong choice destroys user data, and it deserves a test that
  deletes an image, undoes, and asserts the blob is still there.

## Data layer

`FileRecord` today is `{ id, noteId, blob, mime }`. K1 adds:

```ts
width: number;   // after downscaling
height: number;
bytes: number;   // blob.size, denormalised so a quota check reads no blobs
createdAt: number;
```

**`files.add` changes shape with it.** It is `add(noteId, blob, mime)` today
and becomes `add(noteId, blob, meta: { mime, width, height })`, deriving
`bytes` from `blob.size` and `createdAt` from the injected clock rather than
taking either from the caller — a caller-supplied size is a second source of
truth for something the blob already knows. The repository has exactly zero
call sites today, so no migration of callers is involved.

`width`/`height` let the placeholder reserve the right box before the blob
resolves, which is what stops the reflow. `bytes` and `createdAt` are K2's
quota and sweep, added now because a Dexie version bump is cheaper once than
twice — see `tag-index-and-startup.md` on `db.version(n).upgrade()`.

The database is at `version(3)` today (`src/data/db.ts:68`, added by D2), so
this is `version(4)`. **A Dexie version is IndexedDB version × 10** — 40, not
4 — which matters to `e2e/fixtures/seed.ts`, whose raw IndexedDB connection
must open at the same number or Dexie blocks on an upgrade forever and the
page renders as a bare `#root` with only a `console.warn` as evidence. Existing `files` rows have no dimensions; the upgrade leaves them absent
rather than guessing, and the NodeView treats absent dimensions as "unknown
ratio" — there are no such rows in practice, since nothing has ever written
one.

## Testing

**Unit.** The downscaler against a synthetic bitmap: an oversized image comes
back within bounds, an undersized one is still re-encoded to WebP, aspect
ratio is preserved, and a non-image is rejected. The path matcher: `files/
<id>.webp` matches, `https://…/files/x.webp` does NOT, `files/../x` does not.

**A caveat that will bite:** `vitest.setup.ts` swaps the global `Blob` for
Node's, so `instanceof Blob` is false under test and true in a browser
(CLAUDE.md). Duck-type. `OffscreenCanvas` and `createImageBitmap` do not exist
in jsdom at all, so the downscaler takes its canvas factory as an injected
dependency and the unit tests supply a fake; the REAL encode is covered in
Playwright, which is the only place a genuine WebP gets produced.

**Component.** `StoredImage`'s three states, and that the object URL is
revoked on unmount — asserted by spying on `URL.revokeObjectURL`, because
nothing else can see a leak.

**Round trip.** `![](files/<id>.webp)` in, byte-identical out, in the
`CANONICAL` fixtures. A remote URL still lands on `RawImage`.

**e2e.** The real thing, in a real browser, because the encode and the
clipboard are both unavailable in jsdom: paste an image, assert an `<img>`
appears with a `blob:` src, reload, assert it is still there. Playwright can
synthesise a paste with a real `File` through `DataTransfer`.

**And the test that matters most:** delete the image from the text, undo,
assert the blob still exists. That is the one path where a bug destroys
something the user cannot get back.

## Risks

- **The sweep deletes a file the user still wants.** Mitigated by running it
  from the written text inside the transaction, and by the undo test. This is
  the highest-consequence risk in K1.
- **Object URL leak.** Invisible to every gate; only the revoke spy and a real
  phone can see it.
- **WebP re-encoding a screenshot of text is lossy**, and q80 on fine UI text
  can visibly soften it. If it looks wrong at 80, the number moves — it is one
  constant, and the shots harness is how it gets judged rather than argued.
- **A note synced from another device shows placeholders until K2.** Named in
  the non-goals, and the reason the missing state is quiet rather than an
  error.

## The rest of K

- **K2 — the Mac Mini.** Upload endpoint, on-disk storage, auth, a 2 GB
  account quota, and pull-on-demand so an image pasted on the Mac appears on
  the phone. `bytes` and `createdAt` are added in K1 for this.
- **K3 — resize and export.** Drag-to-resize, which needs a width in the
  Markdown and therefore touches the schema; and images in Markdown (as a
  bundle), HTML (inlined) and PDF — the last of which is hard, because the
  renderer is a separate container with deliberately no route off the host.
- **K4 — the thumbnail.** `src/features/notes/thumbnail.ts` reads the first
  REMOTE image URL out of the Markdown, because that was the only image source
  that existed when the note row was redesigned. Once files are stored it
  should read those, and the recorded inconsistency — "the list shows a
  picture the editor shows as raw monospace text" — closes.
