# K2 — Images on the Mac Mini

**Status:** specced, not started. 2026-08-26.
**Parent:** K (Image storage), the second of four. K1 shipped the same day; K3
and K4 remain.

## Why this exists

K1 stores a pasted screenshot in the browser that pasted it and nowhere else.
A note synced to another device arrives with `![](files/<id>.webp)` in its text
and no bytes behind it, so the row and the editor both show the quiet
"Image not on this device yet" placeholder that K1 built for exactly this
moment.

K2 makes the bytes travel.

## Decisions already taken

Settled in conversation on 2026-08-26.

| Decision | Choice |
| --- | --- |
| Download | **Lazy** — fetched when a note that shows the image is opened |
| Server deletion | **Only when the note is purged**, or the account is deleted |
| Quota | **2 GB per account** |
| Bytes at rest | **On disk**, in a Docker volume; MariaDB holds metadata only |
| Transfer | **Its own binary endpoints**, not the JSON `/sync` batch |

## Goal

An image pasted on the Mac appears on the phone, and the reverse.

**Done means:** paste on device A, sync, open the note on device B, and the
image is there. Offline, both devices keep working exactly as they do now.

## Non-goals

- Drag-to-resize, and images in Markdown / HTML / PDF export (**K3**).
- Any change to how images are captured, downscaled or referenced (**K1**,
  shipped and unchanged).
- Sharing an image between accounts, or a public URL for one. Every byte is
  reachable only by the session that owns it.
- Reclaiming server-side orphans. Ruled out above, deliberately: a sweep
  cannot know whether a device that has been offline for a week still shows
  the image, and 188 GB of free disk is a cheaper answer than that risk.

## Storage

**Bytes on disk, metadata in MariaDB.** A new `image_files` table alongside
`notes` and `tag_meta`, cascading from `users` the same way, so
`DELETE FROM users WHERE id = ?` remains the one statement that removes an
account. The blob itself lives at `${IMAGE_ROOT}/${userId}/${fileId}.webp` in
a Docker volume.

**Not a `MEDIUMBLOB`.** MariaDB would hold them, but every `mysqldump` would
then carry hundreds of megabytes of pixels, the buffer pool would churn on
data that is never queried, and the one operation that matters — stream these
bytes to a client — is what a filesystem is for.

```sql
CREATE TABLE image_files (
  user_id    CHAR(36) NOT NULL,
  id         CHAR(36) NOT NULL,
  note_id    CHAR(36) NOT NULL,
  mime       VARCHAR(64) NOT NULL,
  width      INT      NOT NULL,
  height     INT      NOT NULL,
  bytes      INT      NOT NULL,
  created_at BIGINT   NOT NULL,
  PRIMARY KEY (user_id, id),
  KEY idx_image_files_user_note (user_id, note_id),
  CONSTRAINT fk_image_files_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**`note_id` is stored but never trusted for authorisation.** `user_id` is what
scopes every query — `scripts/serverBoundaries.test.ts`'s multi-tenancy guard
requires `user_id` in a predicate position on every statement naming a
user-scoped table, and one forgotten `WHERE` is a cross-user image leak.

**A row without its file, or a file without its row, must not break anything.**
The two are not written atomically — a filesystem and a database cannot be —
so the order is: write the file, then insert the row. A crash between them
leaves an unreferenced file, which is invisible and costs disk. The reverse
order would leave a row promising bytes that do not exist, which a client
would read as a permanent 404.

## Transfer

Two endpoints, both authenticated by the existing session cookie.

**`PUT /files/:id`** — the raw bytes as the request body, `Content-Type:
image/webp`, with `X-Note-Id`, `X-Width` and `X-Height` headers.

- Rejects a body over **5 MB** (`413`). K1 downscales to 2048px/q80, which
  lands well under that; the limit is a guard against a client that did not.
- Rejects anything but `image/webp` (`415`). K1 stores exactly one format, so
  a second one arriving means a client is wrong and guessing is worse than
  refusing.
- Rejects when the account is at quota (`413`), the same shape `/sync`'s
  quota rejection already uses so the client has one case to handle.
- **Idempotent.** A re-upload of an id that already exists is a `200`, not a
  conflict: ids are generated client-side and a retry after a dropped
  connection is the ordinary case. It does NOT overwrite — the first bytes
  win, because an id names an immutable image.

**`GET /files/:id`** — the bytes, `Content-Type: image/webp`,
`Cache-Control: private, max-age=31536000, immutable`.

- `404` when the row is missing OR the user does not own it. **The same
  response for both**, deliberately: distinguishing them tells an attacker
  which ids exist.
- Immutable caching is safe precisely because an id names one image forever.

**Not part of the `/sync` batch.** That endpoint moves JSON and is bounded by
`MAX_BODY_BYTES` (30 MB, `server/src/routes/sync.ts:27`); base64-ing pixels
into it would inflate them by a third and put a binary transfer behind a text
protocol's limits — and a single large paste could then push a legitimate note
batch over that ceiling, so images would be able to break note sync.

## The client

**Upload is driven by the sync engine, not by the paste.** `files.add` marks
the file dirty in `syncState` — the same table and mechanism notes and tags
already use — and the engine uploads dirty files after it pushes notes.

**Notes first, then files, and the order is load-bearing.** A file uploaded
before the note referencing it means another device can pull a note it cannot
render… which is the placeholder, and harmless. The reverse — a note pushed
whose image is not yet up — is the same state. Either order is recoverable, so
the order is chosen for a different reason: pushing notes first means a
`413 quota` on an image cannot block the note's own text from ever syncing.
**Text matters more than pixels.**

**Download is lazy, and the miss path already exists.** K1's
`acquireObjectUrl` deliberately does not cache a miss "because the bytes can
arrive later (K2)". K2 is that later: on a miss, the loader asks the server
once, stores what comes back through `files.add`, and the view re-resolves.

- A miss with **no session** stays a placeholder. No request, no error.
- A miss that **404s** stays a placeholder, and is not retried for that view.
- A miss that fails on the **network** may be retried when the note is
  reopened. This is why the miss is not cached.

**One fetch per file, however many views want it**, for the same reason
`acquireObjectUrl` reference-counts: a note with one image open in the editor
and visible in the list row must not fetch twice.

## Quota

**2 GB per account, and it is its OWN quota — not added to the note quota.**
D2's `QUOTA_BYTES` is 10 MB and governs note TEXT
(`server/src/repositories/sync.ts:5`); summing pixels into a text budget would
make one screenshot exhaust it two hundred times over. `IMAGE_QUOTA_BYTES` is
separate, checked as `SUM(bytes)` over the user's `image_files` rows — the
same denormalised-size trick D2 already uses, so the check reads no blobs.

Over quota, `PUT` returns `413` with `{ used, limit }` and the client surfaces
it through `NoteEditor`'s existing `role="status"` strip, alongside the save,
export and oversized-image messages. **The image stays local and usable.** It
simply does not travel, which is a far better failure than refusing the paste.

## Account deletion

`DELETE /account` already calls `deleteUser`, which is a single
`DELETE FROM users WHERE id = ?` (`server/src/repositories/users.ts:88`), and
every user-scoped table cascades from it — `image_files` will too. K2 adds the
one thing a cascade cannot reach: the account's directory under `IMAGE_ROOT`,
removed in the same handler.
**A cascade that leaves the pixels on disk is not a deletion**, and this is the
spec's day-one requirement rather than a nicety.

## Testing

**Server, integration.** Upload, download, and the four refusals (too large,
wrong type, over quota, not signed in). One test per refusal, each asserting
the status AND that nothing was written to disk. A cross-user test that fetches
another account's id and gets a `404` — the multi-tenancy guard is static
analysis and cannot see a missing `WHERE` in a code path it does not model.

**Server, unit.** The quota sum, the idempotent re-upload, and the write
order — file before row — verified by making the row insert throw and
asserting the file is on disk without a row rather than the reverse.

**Client.** The engine uploads dirty files after notes and not before; a
`413` leaves the file local and dirty rather than dropping it; the lazy loader
fetches once for two consumers; a 404 does not retry within a view; no session
means no request at all.

**e2e.** Two browser contexts against one account — the only test that proves
the whole path — paste in A, sync, open in B, assert a real `<img>` with a
non-zero `naturalWidth`. `e2e/sync.spec.ts` already runs two contexts and is
the pattern to copy.

**And the thing no test can see:** whether a 3 MB upload over a phone
connection feels acceptable. That needs the real device.

## Risks

- **A file on disk with no row, or a row with no file.** Ordered writes make
  the first harmless and the second impossible. Named because the ordering is
  easy to reverse while refactoring and nothing fails loudly if it is.
- **The image root must be a volume, not the container's filesystem.** A
  container rebuild would otherwise delete every image, silently, and the
  first anyone would know is placeholders everywhere. `docker-compose.yml` and
  `server/README.md` both have to say so.
- **`IMAGE_ROOT` escaping.** The path is built from a session's `userId` and a
  client-supplied `id`. The id must be validated against the same
  `[A-Za-z0-9_-]` shape `storedImagePath` enforces before it reaches a path
  join, or `../` walks out of the volume.
- **Lazy download on a metered connection.** Opening a note with ten
  screenshots fetches ten files. Acceptable, and the reason download is not
  eager.

## What K2 does NOT change

K1's capture path, the Markdown contract, the local reclamation sweep, and the
privacy rule that a remote URL never renders. A device that never signs in
behaves exactly as it does today.
