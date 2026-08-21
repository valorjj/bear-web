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

**A is now the next sub-project.** (A fourth, **D — server sync and OAuth**, was added on 2026-08-21 and is deliberately last; see its section below.) Its section below is unchanged and still
current — nothing B did touched the note-list header.

## The three sub-projects, in order

Chosen from four Bear screenshots the user supplied. All three are
**architectural** — each gets its own spec, plan, and implementation cycle.
Order is A → B → C, and the reasoning matters more than the order:

### A. Note-list header

A header naming the current scope, with a dropdown carrying **sort order** and
**preview style**. Bear's version also lists every scope with `⌥⌘1`–`⌥⌘0`
shortcuts.

- **The header itself is trivial; the dropdown's contents are not.** Ordering is
  hardcoded `byPinnedThenRecent` in `src/data/repositories/notes.ts` (Trash
  sorts by `trashedAt`), so a user-chosen sort changes a data-layer contract and
  needs a durable preference.
- **Preview style** touches `NoteListItem`, which has a pinned `aria-label`
  contract and a deliberately reserved two-line snippet height
  (`min-h-[2.0625rem]`). Both are load-bearing; see CLAUDE.md.
- **Open question, not yet decided:** whether the scope list belongs in the
  dropdown at all. Bear can collapse its sidebar, so that menu is sometimes the
  only route to a scope. Ours is always visible, which may make it redundant.
- First because it is the least entangled, and because its parts can be cut
  freely — drop sort or preview style and the header still stands alone.

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

## D. Server sync and OAuth login — new 2026-08-21, unspecced

Raised by the user mid-session while A was being planned: a MariaDB instance in
Docker on a local Mac Mini, and OAuth2 login with Google, GitHub and Naver.

**This reverses the project's founding premise** — "No backend, no account —
everything lives in the browser's IndexedDB" — so it is not a feature in the
A/B/C queue. It gets its own brainstorm, spec and plan.

Decisions already taken, so they are not re-derived:

- **Local-first is KEPT.** IndexedDB stays the source of truth; the server is a
  sync target holding a per-user copy for backup and cross-device access. The
  app must keep working with the Mini asleep or off-network. Consequence: this
  project owns a conflict-resolution decision (last-write-wins, per-note
  versioning, or CRDT) and that is its hardest part, not the schema.
- **Single user.** OAuth is identity for sync, not multi-tenancy. No sharing,
  no permissions, no per-note ACLs.
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

Worth a spike before the spec: whether the Mini can expose HTTPS reliably, what
Naver OAuth requires for this account, and how auth behaves when the server is
unreachable.
