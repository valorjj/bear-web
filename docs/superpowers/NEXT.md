# Next up

Written 2026-08-20 after M8 + M9a shipped; updated 2026-08-21 when B shipped.
This file exists so a fresh session can resume without re-deriving decisions
already made. Delete a section once its sub-project has a real spec in
`docs/superpowers/specs/`.

## Where things stand

- `main` carries M8 (export, tables, chrome), M9a (five themes, picker,
  contrast harness, spacing and type scales, Soft Depth) and **B (collapsible
  headings)**. Live on Pages.
- 1221 unit tests, 64 end-to-end. All six gates green.
- `m8-visual-and-export` and `b1-collapsible-headings` are merged and can be
  deleted whenever.

**A shipped on 2026-08-21.** **B2 and C are what remain**, and their relative
order is still undecided — nobody has ruled on whether either blocks the other.
A fourth sub-project, **D — server sync and OAuth**, was added the same day and
is deliberately last; see its section below.

## The three sub-projects, in order

Chosen from four Bear screenshots the user supplied. All three are
**architectural** — each gets its own spec, plan, and implementation cycle.
Order was A → B → C; **A and B have both shipped**, and the reasoning below
matters more than the order:

### A. Note-list header — **SHIPPED 2026-08-21**

Spec: `docs/superpowers/specs/2026-08-21-a-note-list-header-design.md`.
Plan: `docs/superpowers/plans/2026-08-21-a-note-list-header.md`.
Rulings: `docs/rulings/scopes-and-search.md`, `markdown-and-schema.md`,
`accessibility.md`, and the struck note-list-header item in `deferred.md`.

What landed: a chevron button naming the scope, opening a flat menu with a note
count, three sort fields plus a direction toggle, three preview densities, a
hide-sub-tag-notes filter, and all seven builtin scopes with shortcuts. Sort and
preview persist globally. This closed the "note list has no header naming the
current scope" deferral open since M3.

Five things diverged from this file's original sketch or were only learned by
building it, each worth carrying forward rather than rediscovering:

- **The shortcuts are `⇧⌘1`–`⇧⌘6` and `⇧⌘0`, NOT Bear's `⌥⌘` family.** B1
  shipped heading levels on `@tiptap/extension-heading`'s
  `` `Mod-Alt-${level}` ``, so `⌥⌘1` with the editor focused would make an H1
  and switch scope at once. `Ctrl`+digit is free in Tiptap and rejected anyway
  — it switches browser tabs off macOS, and this ships to Pages. Bear's digits
  are kept; only the modifier differs. **`⇧⌘7/8/9` are unavailable** (ordered
  list, bullet list, blockquote), so a future Archive list cannot take Bear's
  `⇧⌘9`.
- **The digits follow `SMART_LIST_IDS`, not Bear.** Bear orders 잠긴항목 before
  고정됨; our sidebar has always run pinned before locked, and a digit
  disagreeing with the row above it is worse than one disagreeing with another
  app. Positions 1–4 and 0 match Bear regardless.
- **The scope list DID belong in the menu.** This file left that undecided on
  the grounds that our always-visible sidebar might make it redundant. It is
  redundant, and it stays: the menu is where the shortcut hints live, and a
  shortcut nobody can discover is a shortcut nobody uses.
- **The menu is flat, not nested.** Bear nests 정렬 and 미리 보기 스타일.
  Nesting costs hover-intent timing, a second placement layer and focus return
  on close, none of it unit-testable because jsdom has no layout engine to
  place a submenu against — for a menu that is sixteen rows flat.
- **`useSetting` needed an optimistic value after all**, which the spec did not
  anticipate. Two menu clicks in quick succession each derived from the
  rendered value, so choosing "Title" then flipping "Newest first" silently
  discarded the field just chosen. Same fire-and-forget window `usePaneWidths`
  documents.

Cut from Bear's menu, with reasons: bulk 메모 내보내기 (per-note export shipped
in M8b; scope-wide export needs its own filename and archive story), 첨부 파일
숨기기 (no attachments until image storage is scheduled), and collapsing search
behind a magnifier (churns `SearchField` coverage for nothing A needed).

### B. Collapsible headings + level badge — **SHIPPED 2026-08-21**

Spec: `docs/superpowers/specs/2026-08-20-b1-collapsible-headings-design.md`.
Plan: `docs/superpowers/plans/2026-08-20-b1-collapsible-headings.md`.
Rulings: `docs/rulings/markdown-and-schema.md`, `design-tokens-and-layout.md`,
`accessibility.md`.

Shipped as **B1**, deliberately split from **B2** (drag-to-reorder, still
queued). What landed: a hover gutter chevron folding a section, a `≡N` badge
opening 머리말 1–6 with fold / collapse-all / expand-all, folds persisting per
note across switches and reloads, and a delete-key guard at the fold boundary.

Four things diverged from this file's original sketch, each for a reason worth
carrying forward rather than rediscovering:

- **The shortcuts are `⌘⌥1`–`⌘⌥6`, not `⌘1`–`⌘6`.** Browsers own `Cmd-1`..`9`
  for tab switching and a page cannot `preventDefault` it. The `⌘⌥` family
  already existed in `@tiptap/extension-heading`; the menu only surfaced it.
- **Fold toggle is `⌘⌥F`, a genuinely new binding.** `⌘⌥0` was tried and
  rejected — it is `@tiptap/extension-paragraph`'s `setParagraph`, and Tiptap's
  reversed extension order means a later extension silently wins. Verify any
  new binding against `node_modules/@tiptap`, not just against browser
  shortcuts.
- **The gutter is reserved, not overlaid.** This file said the badge sits
  "outside the measure"; it does above a 688px pane, but below that the column
  clamps rather than letting the control overflow, because `EditorContent`'s
  `overflow-auto` clips left-side overflow entirely.
- **The gutter controls are mouse-only.** Chromium refuses `.focus()` to every
  descendant of a heading containing a ProseMirror widget — measured across
  seven experiments. `⌘⌥F` is the keyboard and screen-reader route.

### B2. Drag-to-reorder headings — queued, unspecced

Grab the badge to move a heading and its whole subtree, with a drop indicator.
Split out of B because it is a document mutation with its own coordinate math
and undo semantics, and because jsdom has no `setPointerCapture`, so Playwright
would be its only possible coverage. Ordering relative to C is undecided.

### C. Code block language + syntax highlighting

Language autocomplete on the fence (typing ` ```java ` suggests `java`,
`javadoc`, `javascript`, …), and the highlighting that motivates it.

- **Nothing exists today**: no `lowlight`, no `highlight.js`, no language UI.
  Code blocks are plain text.
- **This is the only one of the three that can make the app worse at its stated
  goal.** Highlighting means shipping grammars into a bundle already at 847 KB,
  for an app whose first two adjectives are *lightweight* and *fast*. A curated
  language subset is the likely answer, but it is a decision to take
  deliberately, not to discover afterwards.
- Last, so the bundle decision is made with the other two already banked.

## Cut, with a reason

- **"여기로 링크 복사" (copy link to here)**, from Bear's heading dropdown. It
  needs per-note and per-heading URLs, and this app has no routing at all — no
  history, no deep links. That is a fourth sub-project wearing a menu item's
  clothing.
- **M9b callout blocks.** Specced in M9a's decomposition and deliberately not
  chosen this round. Still unblocked and still worth doing.

## The item that is still missing from the goal

**Image storage.** The stated goal is "lightweight, fast, beautiful, easy to
use, markdown, **image storage**", and no milestone has ever scheduled it.
Blobs in IndexedDB, an image node in the editor schema, Markdown round-trip,
embedding in HTML and PDF export, backup and import, and a story for eviction
and quota. Bigger than A, B and C together; none of them block it.

## D. Server sync and OAuth login — **D1 AND D2 BOTH SHIPPED**

Spec: `docs/superpowers/specs/2026-08-21-d-server-sync-and-oauth-design.md`.
Plan: `docs/superpowers/plans/2026-08-23-d2-sync-protocol.md`.
Rulings: `docs/rulings/sync.md`.
It supersedes this section; the notes below are kept only where the spec cites
them. **Read the spec, not this.**

Raised by the user mid-session while A was being planned: a MariaDB instance in
Docker on a local Mac Mini, and OAuth2 login with Google, GitHub and Naver.

**Two things below were overturned during the 2026-08-21 brainstorm:**

- ~~**Single user.**~~ **STRUCK.** D is a real multi-tenant product with open
  signup: guest mode on IndexedDB with no account, and per-user isolated notes
  once signed in. The user reversed this deliberately after being shown the
  cost. Consequence: rate limits, per-user quota and `DELETE /account` are
  day-one requirements.
- ~~**Naver.**~~ **DROPPED from D.** Google first, then GitHub. Not ruled out
  later.

Settled by the same brainstorm: the app moves to the apex **`markflowing.com`**
(Pages, `base: '/'`) with the API at **`api.markflowing.com`** (Cloudflare
Tunnel), because same-site is what allows an HttpOnly cookie session instead of
a token in localStorage. Server is **Node + TypeScript in `server/`** as a fifth
tsconfig project, so it imports `src/data/types.ts` and cannot drift. Conflict
resolution is **last-write-wins with the losing edit kept as a `(conflict)`
note**. Sync is automatic and quiet. D splits into **D1** (hosting, accounts,
Google login — no note data on the wire) and **D2** (the sync protocol).

**This reverses the project's founding premise** — "No backend, no account —
everything lives in the browser's IndexedDB" — so it is not a feature in the
A/B/C queue. It gets its own brainstorm, spec and plan.

Decisions already taken, so they are not re-derived:

- **Local-first is KEPT.** IndexedDB stays the source of truth; the server is a
  sync target holding a per-user copy for backup and cross-device access. The
  app must keep working with the Mini asleep or off-network. Consequence: this
  project owns a conflict-resolution decision (last-write-wins, per-note
  versioning, or CRDT) and that is its hardest part, not the schema.
- ~~**Single user.** OAuth is identity for sync, not multi-tenancy.~~ **STRUCK
  2026-08-21 — see the strike above.** Open signup, per-user isolation. Sharing,
  permissions and per-note ACLs remain out of scope.
- **A ships first.** Nothing in A depends on this, and this does not block A.

Constraints established when it was raised, each of which shapes the spec:

- **A browser cannot speak MySQL's wire protocol.** "Hook up MariaDB"
  necessarily means an HTTP API service in front of it. The server is the
  project; the database is the small half.
- **OAuth2 needs a confidential client**, so the Google / GitHub / Naver
  secrets live on that server and never in the bundle. Naver additionally
  requires registered redirect URIs.
- **The live site is `https://valorjj.github.io/bear-web/` and cannot reach a
  Mac Mini on a LAN.** Mixed content blocks `http://`, and a local hostname is
  not routable from outside the network. A public HTTPS endpoint (Cloudflare
  Tunnel or equivalent) plus CORS is a prerequisite, not a detail — without it
  the deployed app and the local app become two different products.
- **"Runs every day" is not "always."** Availability gaps are the normal case,
  which is exactly why local-first is kept.

### D1. Hosting, accounts, Google login — **SHIPPED 2026-08-21**

**D1 shipped, merged, deployed and was verified live on 2026-08-21.** Real
Google sign-in works on `https://markflowing.com`; the session row, the
`__Host-` cookie, and the 401/403 paths were all confirmed against the running
deployment, not only against tests.

### D2. The sync protocol — **SHIPPED 2026-08-23**

Plan: `docs/superpowers/plans/2026-08-23-d2-sync-protocol.md`. Ledger:
`.superpowers/sdd/2026-08-23-d2-sync-protocol/progress.md` (gitignored,
deleted after this session — everything worth keeping from it is folded into
`docs/rulings/sync.md` and here).

What landed: the per-account revision counter, `GET`/`POST /sync` with
tombstones and a 90-day sweep, Dexie version 3 plus a `syncState` table,
dirty-tracking on every note and tag write, the sync engine
(`createEngine(deps).syncOnce`), a four-state status indicator in the account
menu, the guest-note adoption dialog for a first sign-in or an account switch,
and the `(conflict)` note for a losing edit. **This is the change that makes
the D paragraph above literally true: note data now crosses the network.**
`src/data/sync/`, `syncState` and `src/features/account/` are the modules a
future change to any of this touches — see `docs/rulings/sync.md` for the
constraints no test enforces before touching them.

Ten things diverged from the plan or were only found during review, each
worth carrying forward rather than rediscovering (full detail in
`docs/rulings/sync.md`):

- **The tag-reindex helper was duplicated verbatim by two tasks** written from
  the same plan; extracted once, to `src/data/reindex.ts`'s `reindexNote`,
  used by both the notes repository and the engine.
- **The sync cursor and `SyncOutcome.rev` never move backwards** —
  `Math.max(remote.rev, result.rev)`, not `result.rev` — because a push that
  wrote nothing reports a lower revision than the pull already advanced past.
- **The `(conflict)` marker lives in the copy's TEXT, not its `title`.**
  `deriveTitle` re-derives `title` on the next edit and on the moment a second
  device pulls the copy, so a title-only marker evaporates exactly when it is
  most needed.
- **A conflict comparison widened to metadata (`pinned`/`trashedAt`/
  `archivedAt`) was tried and reverted.** It resurrects, on every device, a
  note trashed on two devices at once — worse than the text-only comparison it
  replaced, which was already correct.
- **Two data-loss paths were found and closed in review**, both in the
  engine's accept loop: a purge landing mid-push (fixed by reading the
  CURRENT `syncState` row, not the collected snapshot) and `markAllDirty`
  pinning every row `dirty` forever (fixed by stamping each note's own
  `updatedAt`, not one shared "now", as `markedAt`).
- **`useT()` takes no arguments; this app has no string interpolation at
  all.** The plan guessed a `{count}` placeholder for the adoption dialog's
  count; it does not exist, and the dialog composes its sentence from two
  separate translation keys instead.
- **The rate limiter on `/sync` keyed on the raw `Cookie` header**, so any
  caller varying one byte got a fresh bucket — fixed to key on the extracted
  session token, falling back to `clientIp` only when absent.
- **`readBatch`'s validation gap accepted a note missing
  `trashedAt`/`archivedAt`/`pinned`/`deleted`/`createdAt`** and let it reach
  `mysql2`, which throws on an `undefined` bind parameter. Worse than a
  crash: the pre-fix behaviour was actually a silent **200**, i.e. malformed
  data accepted rather than rejected. Now a 400 before any SQL binding.
- **Import no longer resets `syncedRev` to 0.** Clearing it on import made
  the user's own restored backup lose to the server copy and land as a
  `(conflict)` note on the most ordinary import flow there is — preserving
  `syncedRev` lets the import correctly overwrite the server's copy instead.
- **A unit-test flake in `NoteEditor.test.tsx` was found, chased down, and
  fixed the way commit `ca40a16` fixed the same class of problem in
  `AppShell.test`: the `waitFor` ceiling around `notes.purge` was raised, not
  the assertion changed**, after reproducing the failure reliably under load
  at a lowered ceiling. Task 5 added a `syncState` get+put inside
  `notes.purge`, narrowing the margin on an already-tight test.

**Corrected debt this session found while touching the numbers below: the
e2e flake count is THREE, not two.** `smoke.spec.ts:102` joins the two
`appearance.spec.ts` flakes already known — its cause is named:
`usePaneWidths` writes settings fire-and-forget with no way for a test to
await the write, and D2's own `syncState` get+put on every note write shifted
timing enough to surface it more often. None are D2 regressions — the failing
set varies run to run and every one passes in isolation.

**Not part of D2, named and deferred rather than silently dropped** (see
`docs/rulings/sync.md`'s "Known gaps" section for the full list): import
being "replace" locally but "merge" against the server; an orphaned
`syncState` row surviving an import at `dirty: 0`; `sweepTombstones`'s
non-atomic count-then-delete; the tag accept branch's missing in-flight-edit
guard; `AdoptNotesDialog` mounting unconditionally beside the account
popover.

**Two things D1 built that D2 depended on, exactly as anticipated:**
`pool.transaction()` and `users.rev_counter` (`001_init.sql`) — no migration
was needed to start using either.

**Live environment facts that are not recoverable from the repo:**

- `server/.env` holds PRODUCTION origins; `server/.env.local` (gitignored,
  documented in `server/.env.example` and `server/README.md`) holds
  localhost ones for `npm run server:dev:local`. **The two servers cannot run
  at once** — both want port 8787, the one redirect URI registered in the
  Google console.
- The `markflowing` tunnel is the machine's **single** cloudflared connector;
  the tool allows only one system service per machine. `lunch-api`,
  `docs-api` and `yjs` were deliberately deleted — those projects are retired.
- MariaDB is `markflowing-mariadb` on **127.0.0.1**:3308 (loopback, not all
  interfaces). Dev database `markflowing`, test database `markflowing_test`.
- **The API server is STILL NOT a service**, and D2 did not change that. It
  runs as `npm run server:dev`, `tsx watch` started by hand, and it has
  already gone down once when the machine slept: the tunnel stayed up and
  `api.markflowing.com` answered **502** while the apex kept serving the app
  perfectly. Local-first means the app is fine either way, so nothing shouts.
  **Giving it a launchd service and a non-watcher start command is the next
  thing worth doing after D2** — it was named debt at D1 and remains so.

**Known debt, carried forward. None of it blocks anything queued:**

- **`ThemePicker` has the same `overflow-hidden` clipping bug** `AccountMenu`
  had, just narrower so it has not bitten. The fix mechanism now exists in
  `AccountMenu` — viewport-coordinate placement — and is a small change.
- **The rate limiter's window `Map` is never pruned.** One stale entry per
  distinct key, forever. Wants a TTL sweep before the service is left
  unattended for long stretches.
- **Sessions roll forever with no absolute cap.** A stolen token that keeps
  being used renews indefinitely. A rolling-vs-absolute design tradeoff, not a
  bug.
- **The OAuth transaction is replayable within its 600s lifetime.** Stateless
  by design; single-use enforcement comes from the provider rejecting code
  reuse. Documented honestly in the code and in `server/README.md`.
- **The default database password is still `markflowing`**, left because
  changing it breaks the existing volume.
- **Three intermittent e2e tests**, not two: `appearance.spec.ts:893`,
  `appearance.spec.ts:1021`, and now `smoke.spec.ts:102`, each passing in
  isolation. Playwright retries them; Vitest does not retry, so a flaky
  *unit* test turns main red where a flaky e2e test is merely reported —
  which is exactly the class of bug the `NoteEditor.test.tsx` fix above
  addressed for the one place D2 could see it.
- **Giving the API server a launchd service and a non-watcher start
  command** — named at D1, restated at D2, still not built.
- The "known gaps" list in `docs/rulings/sync.md` — none block anything
  queued, all are named there rather than here so they stay next to the
  constraints they qualify.
