# bear-web

A local-first, web-based notes app modeled on the Bear macOS app. Three panes
(tag sidebar / note list / editor), Markdown notes, organized by inline hashtags
rather than folders. No backend, no account — everything lives in the browser's
IndexedDB.

**Live:** https://valorjj.github.io/bear-web/
**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Plans:** `docs/superpowers/plans/`

## Status

| Milestone                               | State          |
| --------------------------------------- | -------------- |
| M0 scaffold, CI, Pages deploy           | complete       |
| M1 data layer (Dexie)                   | complete       |
| M2 application shell                    | complete       |
| M3 notes CRUD, textarea editor          | complete       |
| M4 editor                               | complete       |
| M5 tags                                 | complete       |
| M5.5 design language                    | complete       |
| M6 smart lists, trash management        | complete       |
| M7 search                               | complete       |
| M7.5 visual design pass                 | complete       |
| M7.6 tag pills                          | complete       |
| M7.7 tag pill activation                | complete       |
| M8 visual pass (chrome, density, prose) | complete       |
| M8b export: Markdown, HTML, PDF         | complete       |
| M9                                      | themes, polish |

1095 unit tests, 45 end-to-end tests. `main` is always green and auto-deploys.

`npm run shots` is a sixth entry point, deliberately not in that count: it drives
`e2e/shots.spec.ts` against the fixed corpus in `e2e/fixtures/corpus.ts` and
writes the design reference screenshots under `docs/design/shots/` (gitignored).
It asserts nothing, and `grepInvert` in `playwright.config.ts` keeps it out of
`npm run test:e2e`.

## Commands

```bash
npm run dev          # dev server
npm test             # Vitest, unit + component
npm run test:e2e     # Playwright against the production build
npm run lint         # oxlint
npm run typecheck    # tsc -b across all projects
npm run format       # Prettier
npm run build
```

All six must pass before any commit.

## Toolchain surprises

These bit us once already. They are not mistakes.

- **oxlint, not ESLint.** `create-vite` ships it now. There is no `eslint.config.js`
  and none should be added. Consequence: no import sorting — oxlint has no
  path-grouping equivalent to `simple-import-sort`.
- **TypeScript 6 rejects `baseUrl`.** `tsconfig.app.json` has `paths` alone. The
  alias still resolves under `tsc -b`; this was verified by injection.
- **Four tsconfig projects.** `app` (`src/`), `node` (root configs + `vitest.setup.ts`),
  `e2e` (`e2e/` + `playwright.config.ts`), and the solution root. `vitest.setup.ts`
  deliberately lives in `node`, not `app`, so Node globals stay out of browser code.
  A `process.env` reference under `src/` must fail typecheck.
- **`vitest.setup.ts` swaps the global `Blob` for Node's.** fake-indexeddb clones via
  `structuredClone`, which silently turns a jsdom Blob into `{}`. Consequence:
  `instanceof Blob` / `instanceof ArrayBuffer` are false under test but true in a
  browser. **Duck-type in tests; never `instanceof`.**
- **jsdom has no `setPointerCapture`.** Pointer-drag paths cannot be unit tested;
  they belong in Playwright.
- **jsdom drives the editor's surface too, given three stubs.** Mounting,
  `getJSON()`, `commands.*`, and clicking toolbar buttons outside the editor
  work unaided. Clicking _inside_ the contenteditable or typing into it needs
  `Range.prototype.getBoundingClientRect`, `Range.prototype.getClientRects` and
  `document.elementFromPoint` stubbed — jsdom has no layout engine, so
  ProseMirror's `coordsAtPos`/`posAtCoords` throw on APIs it never implements.
  With those three in place, `userEvent.type` into the contenteditable works and
  `vitest run` exits 0; see the header of `src/features/notes/NoteEditor.test.tsx`
  for the exact stubs and `src/features/editor/toolbars.test.tsx` for the
  related `EditorView.scrollToSelection` stub a block toggle needs. This is what
  lets a Vitest test assert the whole store → editor → store loop. Without a
  stub the errors are **uncaught**, so `vitest run` exits 1 even when every
  assertion passes — check exit codes, not pass counts, when reviewing editor
  tests. Real keyboard shortcuts and anything depending on real layout still
  belong in Playwright.
- `erasableSyntaxOnly` forbids `enum`, parameter properties, and namespaces.
  `verbatimModuleSyntax` requires `import type` / `export type`.
- **`--color-hover` did not exist until M5.5.** `hover:bg-hover` was written in
  `TopControls` and `BottomToolbar` from M4 onward, and Tailwind v4 silently
  emits nothing for a utility whose theme key is absent — no build warning, no
  runtime error — so those buttons had no hover state for two milestones. No
  source-level grep can see this; only the compiled CSS shows a utility that
  never made it in.
- **Subagent worktrees live under `.claude/worktrees/` inside the repo, and
  Vitest globs them.** A parallel subagent-driven dispatch that leaves a
  worktree behind silently runs several extra copies of the whole unit suite
  on every `npm test`, inflating pass counts with no test-writing mistake to
  find.
- **Dexie's `version(1)` is IndexedDB version 10, not 1.** Dexie multiplies its
  declared version by ten. Seeding the database directly from a Playwright init
  script at IndexedDB version 1 therefore leaves Dexie wanting to upgrade 1 →
  10, and the seeding connection — still open — blocks that upgrade forever.
  `openDatabase()` never settles, so `main.tsx` never reaches `createRoot` and
  the page renders as a bare `<div id="root">` with **no error at all**: the
  only trace is a `console.warn` reading `Upgrade 'bear-web' blocked by other
connection holding version 0.1`. `e2e/fixtures/seed.ts` opens at 10 and closes
  its connection in `onsuccess` for exactly this reason.
- **A seeded note must be in place BEFORE Dexie opens the database.**
  `useLiveQuery` observes writes made through Dexie's own connection; raw
  IndexedDB writes from a second connection in the same page are invisible to
  it, so a note inserted after boot sits in the database and never appears in
  the list. This is why `seedDatabase` uses `page.addInitScript` rather than
  `page.evaluate` after `goto`.
- **`playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`.**
  Two parallel `npm run test:e2e` runs — e.g. two subagents, or a human and an
  agent — share that port, so the second run measures the first run's tree
  instead of its own.

## Architecture boundaries

- **These boundaries are enforced by `scripts/sourceLint.test.ts`, not merely
  documented here.** It resolves both `@/`-aliased and relative specifiers to
  `src/`-relative paths before checking them, because `src/ui`, `src/data`,
  `src/lib`, `src/features`, `src/i18n` and `src/app` are flat siblings — a
  relative `../data` from `src/ui/` reaches the data layer in one hop, and an
  alias-only check would have been a one-character bypass.
- `src/ui/` holds presentation primitives. It must import **nothing** from
  `src/app/`, `src/data/`, or `src/i18n/`. That is why `Resizer` takes `min`/`max`
  as props rather than importing the pane-width constants.
- `src/ui/SidebarRow.tsx` is the shared row primitive for the tag tree, and is
  meant to be reused by M6's smart lists and M7's search results rather than
  each growing its own row markup.
- Components reach persistence **only** through `src/data/index.ts`, never a
  repository module directly.
- `src/lib/` holds framework-level hooks with no product knowledge —
  `useFlushTriggers` today. Like `src/ui/`, it must import **nothing** from
  `src/app/`, `src/data/`, `src/features/` or `src/i18n/`; unlike `src/ui/`, it
  is behaviour rather than presentation. (The M4 spec places this directory at
  `src/app/`; the spec is wrong and has been corrected.)
- **No user-facing string is hardcoded in a component.** Everything goes through
  `useT`. `src/i18n/en.ts` defines the key type; `ko.ts` is annotated
  `Record<TranslationKey, string>` so a missing translation is a compile error.
  Never weaken that annotation to silence an error — add the translation.
- Every colour comes from a CSS custom property. Literal hex or `rgb()` outside
  `src/styles/tokens.css` is a defect.
- IndexedDB is the single source of truth for durable data; components subscribe
  via `useLiveQuery`. There is no second copy of note data in application state.
- `src/features/notes/ScopeSidebar.tsx` no longer exists. It shipped in M3 as
  two hardcoded rows (`Notes`, `Trash`) so M3 could ship `trash` and `restore`
  with a path back, on the explicit understanding that M6 would delete it. M6
  did: `SmartListSidebar` renders all seven builtin lists as data
  (`SMART_LIST_IDS`), not a registry grown row by row.
- `parseTags` lives in `src/data/tags/`, not `src/features/tags/`. It is
  injected at `src/data/repositories/index.ts`, and `src/data/` must not import
  from `src/features/`. It also genuinely is data-layer logic: it derives a
  database index. Feature code reaches the index only through
  `notes.listByTag` and `notes.allTagRows` — never Dexie directly. (The parent
  spec sketches the parser under `features/tags/`; the spec is wrong.)

## Rules that must not be silently reversed

Grouped by area. Every bullet below is a live constraint: an audit on
2026-08-14 checked all 115 against the code and found none dead, false or
duplicated. Roughly a third are enforced by no test at all — contrast
ratios, "these tokens must stay independent", ordering guarantees — which
is exactly why they are written down.

- [Tag grammar](#tag-grammar)
- [The tag index, persistence, and startup](#the-tag-index-persistence-and-startup)
- [Notes: editing lifecycle, autosave, reconciliation](#notes-editing-lifecycle-autosave-reconciliation)
- [Scopes, smart lists, and search](#scopes-smart-lists-and-search)
- [Markdown round-trip and the editor schema](#markdown-round-trip-and-the-editor-schema)
- [Tables](#tables)
- [Tag pills and activation](#tag-pills-and-activation)
- [Export](#export)
- [Design tokens, theme, and layout](#design-tokens-theme-and-layout)
- [Accessibility](#accessibility)
- [Testing and tooling conventions](#testing-and-tooling-conventions)

### Tag grammar

- **Tags are keyed lowercase, and that is what makes `rebuildTagIndex`
  deterministic.** `#Work` and `#work` are one tag. Bear preserves first-seen
  casing instead; that was rejected because "first" is undefined during a
  rebuild — note iteration order would decide display casing, so dropping and
  rebuilding the index could change it. The parent spec's rule that a rebuild
  is always safe depends on this.

- **A tag may only start at a `#` preceded by start-of-line or whitespace.**
  This single precondition is why `parseTags` needs no URL, link-destination or
  HTML-attribute detection: `https://x/#a`, `[x](#a)` and `<div id="#x">` are
  all excluded by the preceding character alone. Removing it means adding all
  three.

- **Content beginning with `.,;:!?` is rejected whole, not trimmed** —
  otherwise a shebang in an unmasked indented code block becomes a tag named
  `bin/sh`. A leading slash is rejected by the empty-segment rule instead:
  `#/bin/sh` splits on `/` and produces an empty first segment. The set is
  deliberately narrow: `#-lead` is a legitimate tag.

- **The mask character is `\u0000`, deliberately not a space.** Masked code
  must terminate a tag without permitting one to start — with a space,
  `` `x`#work `` becomes a tag. `src/data/tags/parseTags.test.ts` pins this.
  It must always be written as that four-character escape sequence, never
  pasted or typed as a literal NUL byte — a raw NUL byte looks identical to
  the escape sequence in most editors, but `grep` and `diff` both silently
  mangle it. This milestone hit that twice.

- **A tag's closing `#` must be followed by a boundary and preceded by a
  non-whitespace character.** The multi-word form originally required only that
  the character after the closer be a boundary; a lone `#` later on the same
  line — unrelated prose, not a second tag — would then act as the first
  tag's closer and swallow every word between the two hashes.
  `Fix #bug then see item # 5` produced the tag `bug then see item` instead
  of `bug`, silently destroying the user's actual tag. Fixed by also
  requiring the character before the closing `#` to be non-whitespace,
  symmetric with the existing rule.

- **Indented code blocks and raw HTML blocks are deliberately unmasked.**
  `#define FOO` inside indented C yields one junk tag. That is the accepted
  price of not hand-rolling CommonMark's list-aware indentation rules; the
  obvious cases (`# comment`, `#!/bin/sh`) reject on the grammar alone. Do not
  "fix" this with more masking.

- **Fenced-code recognition needs tail assertions on the fence regex.**
  Without them, `'```code``` is inline'` opens a fence that never closes,
  silently deleting every tag in the rest of the note; and a closer carrying an
  info string inverts fence state, inventing tags from inside code blocks.

- **The NUL-byte hazard is worse than the mask-character rule above states,
  and writing the escape sequence is not sufficient by itself.** Writing
  `\u0000` through a file-writing tool's JSON string parameter silently
  produces a REAL NUL byte on disk anyway, because the JSON layer interprets
  the escape before the bytes reach the filesystem — this happened twice
  during M7.6's Task 2 alone, four times across this project. The rule is not
  "write the escape sequence", it is "write it, then verify the bytes". The
  scan must be scoped to tracked files: `.rglob('*')` over the repo root also
  walks `node_modules`, `dist` and Playwright artifacts, which are full of
  binary NUL bytes and drown the one hit that matters under a thousand that
  don't.
  ```
  git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
  ```
  Run this before every commit that touches tag-grammar prose or code.

### The tag index, persistence, and startup

- **The tag-index rebuild is a settings marker, never a Dexie `upgrade()`
  hook.** A throw inside a versioning transaction means the database never
  opens — the app is bricked with the user's notes on disk and unreachable.
  With the marker a throw costs an empty index and the version is deliberately
  not recorded, so the next launch retries. `runMigrations` must never reject —
  that includes a caller-supplied `onError` that itself throws, which is
  guarded separately — and `TAG_INDEX_VERSION` is bumped whenever the parser's
  output changes.

- **`persistStorage` checks `persisted()` before it ever calls `persist()`, and
  only asks once the database already holds a note.** The order is the whole
  design. `persisted()` only reads state; `persist()` raises a permission
  doorhanger in Firefox, and asking a first-time visitor to grant persistent
  storage before they have written anything is the moment they are most likely
  to refuse — a refusal that sticks. So notes from a user's very first session
  stay evictable until their next launch, which is safe because eviction does
  not happen mid-session. Chrome and Safari never prompt and decide from
  engagement heuristics, which the same gating happens to favour. Do not "fix"
  this by requesting at boot unconditionally. Like `runMigrations`, it never
  rejects, is feature-detected rather than assumed (`navigator.storage` is
  absent in older Safari and some webviews), and guards its own `onError`.

- **`importDatabase` ignores the bundle's `noteTags` rows and rebuilds**, via an
  injected callback. The index is derived; trusting a file's copy contradicts
  that, and it is what made a pre-M5 backup restore an empty index. `backup.ts`
  still has no tag parser and must not acquire one.

- **IndexedDB cannot index booleans or nulls.** `pinned` is unindexed and filtered
  in memory — a `.where('pinned')` query throws at runtime, not compile time. The
  `trashedAt` index contains _only_ trashed notes, because IndexedDB omits
  null-valued records; that is why `.aboveOrEqual(0)` is the correct idiom.

- **The `noteTags` index reflects active notes only**, consistently across `trash`,
  `restore`, and `rebuildTagIndex`. Dropping the table and rebuilding from
  `notes.text` must always be safe.

- **Import is replace-only**, and validates fully before clearing anything, so a
  rejected import cannot destroy existing data.

- **The startup sweep's three content gates are load-bearing but not
  sufficient — a fourth, `createdBefore`, closes a real race.**
  `createdAt === updatedAt` makes a note the user has typed into unreachable
  even if the emptiness check is wrong — the M4 shape where a truncation
  reached `notes.purge`. But the sweep is unawaited and runs after React has
  already mounted and made the app interactive, so a note created in that
  window (widened to seconds by a tag-index rebuild) has empty text, no
  `trashedAt`, and `createdAt === updatedAt` — it passes all three content
  gates legitimately, and the sweep would purge work in progress out from
  under a pending autosave. `SweepDeps.createdBefore` is captured at module
  scope in `main.tsx` before anything else can run, and the sweep skips any
  note whose `createdAt` is at or after it. Like `runMigrations` and
  `persistStorage`, the sweep never rejects, including when `onError` throws;
  a single note's purge throwing is now also caught per-note so it neither
  aborts the rest of the sweep nor gets silently counted as succeeding.

- **The sweep runs after the tag-index rebuild resolves, not concurrently.**
  Both write inside transactions over `notes`; sequencing removes the question
  of what a rebuild sees mid-purge.

### Notes: editing lifecycle, autosave, reconciliation

- **`NoteEditor`'s `seedText` is scoped to the just-created note, and `AppShell`
  must clear it when the selection leaves that note.** A note created inside a
  tag scope is seeded with that tag, so it is not empty and the blank-note
  purge would never reclaim it by the ordinary path — but without clearing
  `seed` on selection change, reopening that note re-arms `seedText`, and a
  note the user has edited down to just its tag is silently purged: exactly the
  tag-only deletion the spec rejected. Widening `isEmpty` to "contains only
  tags" was also rejected — it would delete a note the user deliberately filled
  with nothing but tags.

- **`deriveTitle` is deliberately not idempotent.** `'# # nested'` yields
  `'# nested'`, which is that heading's true Markdown content. Stripping twice would
  delete a character the user typed.

- **`NoteEditor` must be rendered with `key={note.id}`.** The remount is what
  makes an editor instance know exactly one note for its lifetime, so its
  unmount cleanup is a correct flush-on-switch. Removing the key reintroduces
  the entire class of "wrote note A's text over note B" bugs. **No test
  enforces this** — removing the key leaves the whole suite green, because
  `useNotes` routes every selection change through a transient `undefined`
  that remounts `NoteEditor` anyway. See the fuller account under "Carried
  into M5b and M6"; read the two together, because this bullet alone reads as
  if the suite has your back and it does not.

- **`useNotes` reconciles against the database, not the note list.** The list
  lags a creation by one tick, so reconciling against it deselects every note
  the instant it is created. The `{ note }` wrapper on the probe query exists
  to distinguish "still loading" from "loaded, and it is gone".

- **`useAutosave` claims a sequence token per flush.** Overlapping saves are
  real: type, pause past the debounce, keep typing. Only the latest claim may
  mutate `savedRef` or `failed`. Comparing text instead is NOT sound — after a
  rollback, `savedRef.current` can coincidentally equal an older save's own
  pending text, so a value guard passes for a superseded write.

- **`useLiveQuery` returns the _previous_ deps' value for one tick after the
  deps change — never `undefined`.** `dexie-react-hooks`' `useObservable` keeps
  one `monitor` ref across dependency-array changes and only takes a
  synchronous seed value when `!monitor.current.hasResult`; once any query on
  that hook instance has ever resolved, `hasResult` stays `true` forever, so a
  deps change does not reset it to "loading." The hook keeps exposing the old
  deps' cached result until the new `Dexie.liveQuery` subscription resolves in
  a `useEffect` (a passive effect, scheduled after commit — can lag well
  behind the deps change under CPU contention). Confirmed with an isolated
  repro of `useObservable` alone: reading its result in the same tick as a
  deps change deterministically returns the prior deps' value, every time.
  **Any `useLiveQuery` whose deps can change must tag its result with the
  dependency value it was computed for, and only trust the result once that
  tag matches the current dependency** — a mismatch means "still loading,"
  not "loaded." `useNotes` does this for both of its calls: `items` is
  `{ scope, list }` keyed against the live `scope`, and `probe` is
  `{ id: selectedNoteId, note }` keyed against the live `selectedNoteId`;
  either one resolving with a stale tag now falls back to `undefined`/`null`
  instead of being trusted. **`usePaneWidths` is not affected** — its
  `useLiveQuery` deps are the constant `[]`, so there is no "previous deps"
  to leak. `useNotes` is currently the only call site with changing deps; do
  not add the tag-and-verify pattern to call sites whose deps never change,
  it would be dead complexity. Skipping this on a call site that _does_ have
  changing deps means a scope or selection switch can briefly render the
  previous scope's (already-stale) data — surfaced intermittently as a
  full-suite flake in `AppShell.test.tsx`'s "moves a note to the trash and
  restores it" test, and, via the identical mechanism on the `probe` query,
  an even more frequent flake in its "shows each note's own text after
  switching, not the previous note's" test. A real user under load would see
  the same
  thing: a wrong, empty, or stale note list or editor for a frame after
  switching scopes or notes.

- **`NoteEditor` seeds autosave from the MOUNTED EDITOR's own reading, never
  from `note.text`.** Seeded from the raw text, every non-canonical note differs
  from its own serialization the instant it opens, so merely looking at a note
  rewrites it — churning `updatedAt`, reordering the note list, and re-running
  the tag reindex. Opening a note must produce no write.
  **"Opening produces no write" silently depended on two preconditions, and
  both were violated in M4.** (1) `normalizeMarkdown` must be idempotent — a
  trailing hard break broke it, because `<br>` at the end of a block serializes
  to `'a  \n'` and parses back as the plain text `'a  '`. (2) `MarkdownManager`
  and the mounted ProseMirror schema must agree — they did not, and the
  disagreement could DELETE a note (see the next bullet). Seeding from the
  editor's own reading, in an effect after mount, makes the rule hold **by
  construction**: whatever the editor produces at rest is the baseline, so the
  two components no longer have to match for the rule to hold. React runs a
  child's effects before its parent's, which is what makes reading `handleRef`
  in `NoteEditor`'s mount effect safe.

- **The manager and the mounted schema must be asserted to AGREE, through the
  real component.** Every serializer test drives `MarkdownManager` standalone,
  and `NoteEditor`'s correctness depends on exactly the agreement none of them
  checks. `manager.parse('1. ')` emitted a `listItem` with no children, which
  the schema forbids: serializing it threw, and ProseMirror silently dropped it
  on mount, so `read()` returned a shorter document, the first flush wrote the
  truncation, and a total truncation reached `notes.purge`. Typing `1. `,
  switching away, then merely reopening the note DELETED IT. Three independent
  guards now stand between that mechanism and a user's data — `sanitize` in
  `markdown.ts` (closes the invalid-node class, but a serializer asymmetry
  leaves empty headings divergent), the editor-sourced seed above, and `discard`
  refusing to purge a note that held text at mount and was never edited. Keep
  all three; this is the one place in the app where a single point of failure is
  unacceptable. The
  `manager/schema agreement` suite in `NoteEditor.test.tsx` drives the real
  component and is where a new degenerate input belongs.

- **`useAutosave` rolls back to confirmed-persisted text.** `persistedRef`
  advances only when a save RESOLVES; the failure branch restores the dedupe
  baseline to it. Rolling back to the optimistic marker instead reintroduces the
  M3 defect where a buffer that coincidentally re-equals a never-written value
  skips a needed save. The sequence token is separate and still required.

- **Delete always trashes, blank or not.** The blank-note purge was emergent —
  trash, unmount, discard — so one button meant two irreversibilities
  depending on invisible state. `NoteEditor`'s `discard` now refuses to purge
  an already-trashed note. The reclaim path for a blank note the user
  navigates away from is unchanged.

### Scopes, smart lists, and search

- **`NoteScope` is an object union, so every `useLiveQuery` keyed on it uses
  `scopeKey`, never the object.** An object literal has a fresh identity every
  render; passing it as a dependency is an unbounded refetch loop. `ACTIVE_SCOPE`
  and `TRASHED_SCOPE` are module constants for the same reason. The only call
  site that can falsify this is `useNotes.test.tsx`'s refetch test, which needs
  an explicit effect flush to observe anything.

- **Widening a two-armed union to three is not a safe default when logic is
  gated with `===`.** `NoteScope` grew a `tag` arm; `NoteList`'s Trash button
  stayed gated on `scope.kind === 'active'`, which was total over the old two
  scopes and silently became partial — a tag scope rendered neither Trash nor
  Restore, so a note filtered to `#work` had no delete affordance at all, and
  no test covered the missing third arm. Gate the total case (`!== 'trashed'`)
  rather than enumerating the arms that should pass, and add a test for the
  new arm whenever a union grows.

- **A tag filter never deselects the open note.** `useNotes` reconciles on
  trash state alone. Deselecting on tag membership would pull the editor out
  from under someone deleting a hashtag — or merely typing `#wo` on the way to
  `#work`.

- **The vanished-tag fallback must not fire while the tag tree is loading.**
  `useTagTree` returns `undefined` before its live query resolves, and
  `AppShell`'s effect returns early on it. Treating `undefined` as "no tags"
  ejects the user from their own filter on every unrelated edit. **This loading
  guard is currently unreachable in the shipped app** — `scope` starts at
  `ACTIVE_SCOPE` and is not persisted, so nothing selects a tag before the tree
  has resolved once. It is kept as defence in depth against a future persisted
  scope, not because it is load-bearing today; it has no falsifying app-level
  test.

- **`NoteScope` has two arms permanently, and every behavioural question is a
  named capability function.** Adding a smart list is a row in
  `SMART_LIST_IDS`, never a union arm and never a `scope.kind` comparison at a
  call site. `scope.test.ts` asserts capabilities exhaustively over
  `SmartListId`, so a new list without a ruling fails the suite. This is the
  defence against the M5 defect where a widened union silently removed the
  delete affordance from tag scopes.

- **The Todo predicate's test fixture is derived from `MarkdownManager`, never
  hand-written.** The parent spec writes it as "contains an unchecked `- [ ]`",
  which is an assumption about our own output. Our serializer emits `- [ ]`
  and normalizes `* [ ]` to it, but that is a fact about the serializer, not a
  licence to hardcode it.

- **`UNCHECKED_TASK` must not carry the `g` flag.** A global regex keeps
  `lastIndex` between `.test()` calls, so a module-level constant reused per
  note alternates true and false on identical input and drops roughly half the
  matching notes.

- **`UNCHECKED_TASK` matches `-`, `*` and `+` bullets** because `importDatabase`
  accepts arbitrary Markdown and a note is only canonical once it has been
  through the editor. A checkbox the user can see must not be invisible until
  they open the note.

- **A task inside a fenced code block counts as a todo.** Accepted: masking
  code spans lives in `parseTags` in the data layer, and duplicating it for one
  smart list is not worth a second copy.

- **Only `untagged` reads the tag index in `listForScope`.** `allTagRows` is a
  full table scan; paying for it on every scope switch would double the work
  for six of the seven builtins.

- **All seven sidebar counts come from one live query.** Seven independent
  queries would let rows land in seven different frames — the mechanism behind
  M5's collapsed-tag flash — and would let untagged plus tagged disagree with
  all. Its deps are constant `[]`, so the tag-and-verify pattern deliberately
  does not apply. **This property is documented but not enforced.** Splitting
  `useSmartListCounts` into two `useLiveQuery` calls leaves every test green —
  jsdom resolves fast enough that the race never surfaces. Catching a
  regression would need injected staggered resolution: mock `notes.listActive`
  and `notes.allTagRows` with different delays and assert the hook never
  renders a transient state where untagged plus tagged disagrees with all.
  Same mechanism as M5's collapsed-tag flash, so it is a real property, just
  an expensive one to pin.

- **`useSmartListCounts` returns `undefined` while loading, never a
  zero-filled object.** Zeros render as "empty" rather than "not known yet".

- **Pinned notes sort first in every list except Trash.** Trash is ordered by
  deletion time; a pinned note deleted earlier is not more important than one
  deleted later. `pinned` stays unindexed — IndexedDB rejects boolean keys.

- **`ConfirmDialog` focuses Cancel on open.** These guard irreversible deletion
  with no server copy, and an Enter keypress already in flight must not
  destroy anything. `window.confirm` was rejected: it ignores the theme, and
  some embedded contexts suppress it silently, turning a guarded delete into
  an unguarded one. **The focus trap queries `'button'` specifically, which is
  a gap, not a guarantee.** Any future non-button focusable inside the dialog —
  a link, an input — is invisible to both the initial-focus effect and the
  Tab-wrap arithmetic, so it would be skipped by the trap rather than held at
  its edge. Harmless today with exactly two buttons; widen to a standard
  focusable selector the moment a third element is added.

- **Today does not roll over at midnight.** A note edited at 23:59 stays in
  Today until something else re-runs the query. A timer whose only job is to
  move one row is not worth a live subscription.

- **Search is a filter over the list a scope produced, never a `NoteScope`
  arm and never inside a `useLiveQuery`.** Two properties depend on the
  placement. A third arm would reopen the M5 defect where a widened union
  silently made every `===` gate partial. And putting `query` in a
  `useLiveQuery` dependency array would hand search the documented
  previous-deps-for-one-tick behaviour, rendering the previous query's
  results for a frame on every keystroke. `AppShell` applies
  `filterByQuery` to `useNotes`' output, and `useNotes` is untouched.

- **`findMatchRanges` returns indices into `text.normalize('NFC')`, not into
  `text`.** NFC changes string length, so Hangul offsets computed on one form
  do not address the other; `HighlightedText` renders the normalized string
  for exactly this reason. It also returns `[]` rather than shifted ranges
  when `.toLowerCase()` changes length (`'İ'` folds to two code units) —
  losing a highlight is acceptable, marking the wrong characters is not.
  Matching uses `indexOf`, not `RegExp`, so metacharacters are literal with
  no escaping step to get wrong.

- **Creating a note clears the query.** A new note is empty and matches no
  non-empty query, so it would be created invisible — the same defect
  `acceptsNewNote` solves for scopes, with the same resolution. Switching
  scope deliberately does NOT clear it, which is why the no-results empty
  state has its own copy naming the query as the cause.

- **A query never deselects the open note**, for the same reason a tag filter
  never does: the filter runs outside `useNotes`, which still reconciles on
  trash state alone.

- **`NoteList` takes an explicit `emptyTrashDisabled` prop, supplied from the
  UNFILTERED note list.** Gating "Empty trash" on the filtered list meant a
  fruitless search while viewing Trash disabled emptying a full trash — the
  button read "disabled" for a reason that had nothing to do with whether
  Trash actually had anything in it.

### Markdown round-trip and the editor schema

- **`markdown.ts` is the only importer of `@tiptap/markdown`.** The round-trip
  suite drives `MarkdownManager` standalone, with no `Editor` and no DOM, which
  is what lets it be exhaustive and fast. Importing the package elsewhere
  couples serialization to a mounted editor and puts the suite behind jsdom's
  contenteditable limitations. **This is convention enforced by nothing** — there
  is no lint rule, and oxlint has no import-restriction equivalent configured.
  A second importer would simply work. `characterization.test.ts` is a deliberate
  exception: it describes the dependency itself.

- **The round-trip suite asserts three properties, not one.** Fidelity pins what
  each construct must produce; stability proves normalization settles;
  preservation proves unsupported constructs survive. Idempotence alone —
  the parent spec's original wording — is satisfied by a serializer that
  discards every note, so dropping the fidelity suite silently guts the others.
  **These three properties are not interchangeable, and fidelity is the
  load-bearing one.** Fidelity pins exactly one string per construct; stability
  only covers its listed inputs. A defect that is a no-op on the pinned string
  and corrupts every other instance of that construct passed the entire suite
  until stability coverage was extended. Any new construct needs entries in
  **both**.

- **A known, irreducible limit of the round-trip suite:** any serializer defect
  whose output is _itself valid Markdown for the same construct_ — so
  reparsing reproduces it exactly — corrupts every input except the one pinned
  fidelity string, and no amount of stability coverage catches it. Closing that
  needs semantic-equivalence checks or property-based fuzzing, not more cases.
  Do not attempt to fix it with more test cases.

- **Known stable-but-lossy transformations. These are instances of the limit
  above, not new bugs — do not "fix" them.** Each one round-trips to a fixed
  point, so the suite is green, and each one is a legitimate reading of the
  source by CommonMark's rules; only a semantic-equivalence check could tell
  them apart from correct output. Found by the M4 final review:
  `&copy;` → `&amp;copy;`, `a < b` → `a &lt; b`, `my_var_name` →
  `my\_var\_name`, autolinks and reference links rewritten to inline form,
  YAML front matter mangled, and whitespace-only notes normalizing to empty
  (they are no longer purged for it — see the `discard` guard above).

- **A dead custom tokenizer is invisible to round-trip tests.** Inert
  `==text==` serializes byte-identically to a working highlight. Constructs
  whose tokenizer is ours need **structural** assertions on the parsed
  document, not just round-trip assertions.

- **`RawBlock` is why deferring tables and images is safe.** A note containing a
  table already exists in real databases, written in M3's textarea or restored
  from a JSON import. Without the verbatim fallback, opening one and typing
  destroys it with no error and no recovery. Do not remove it when M4b adds real
  table and image nodes — it still covers every other construct `marked` can
  tokenize.

- **Underline is switched off at the schema, in
  `StarterKit.configure({ underline: false })`, and must stay off.** It has no
  Markdown representation; `_underline_` collides with CommonMark italic, and
  serializing to raw `<u>` was considered and rejected. Highlight is `==text==`.
  **This rule needs a SCHEMA-level assertion, and that is why it escaped.**
  StarterKit registers `@tiptap/extension-underline` by default, so for the
  whole of M4 the mark was live: `Mod-U` worked and persisted `++text++`, and
  because `u` then appeared in the schema-derived `recognizedHtmlTags`, an
  existing note's `<u>x</u>` was rewritten to `++x++` instead of being preserved
  verbatim by the raw-inline fallback. The spec, this file, and a passing test
  all asserted the rule while all of that shipped — the test checked that no
  underline BUTTON was rendered, which says nothing about the schema, the keymap
  or the serializer. `src/features/editor/extensions.test.ts` now asserts the
  mark, the command, the `Mod-U` binding and `<u>` preservation. Any future
  "not supported" ruling about a StarterKit-bundled extension needs the same
  treatment: assert on `getSchema(editorExtensions)`, never on the UI.

- **`AllSelection` must be pinned to a `TextSelection` before any block-level
  toolbar command.** ProseMirror's `AllSelection` (what
  `editor.commands.selectAll()` and the real `Ctrl/Cmd+A` keyboard shortcut both
  produce) never collapses to a fixed range — its `.map()` re-derives to "the
  whole document, whatever it is now." Every toolbar action restores this stale
  selection via `.focus()`, so `TrailingNode`'s appended empty paragraph gets
  wrapped by the next toggle, which appends its own trailing paragraph, forever
  — a note that silently grows without bound on repeated clicks. See
  `src/features/editor/toolbarSelection.ts` for the fix and the full diagnosis.
  Verified in a real Chromium browser via Playwright for both the programmatic
  `selectAll()` path and the real keyboard `Ctrl/Cmd+A` path — the two are
  driven by the identical `AllSelection` mechanism and the identical fix closes
  both.

- **Before M7, typing `- [ ] milk` did not create a task item, and that was an
  editor input-rule defect, not a Todo defect.** StarterKit's bullet-list input
  rule fired on `- ` first and converted the block to a `listItem`; `TaskItem`'s
  own `wrappingInputRule` could not then wrap a paragraph already inside a
  `listItem`, leaving the user with a plain bullet and the literal text
  `[ ] milk`, which never reached Todo's predicate. M6's Todo predicate,
  registry, and counts were all verified correct — this was purely the
  M4-era editor never having its own promotion rule for this keystroke. M7's
  `TaskItemPromotion` (see the structural-assertion rule below) closed it; do
  not "fix" a regression here by loosening the Todo predicate to match literal
  `[ ] text` bullets — that was ruled out in M6 and stays ruled out.

- **The bullet-to-task input rule needs a STRUCTURAL assertion, and that is
  why the M4-era version of this bug hid.** A promoted task item and a
  hand-authored one serialize to byte-identical Markdown, so every round-trip
  suite passes whether or not `TaskItemPromotion` fires — the same blind spot
  that let a dead `==highlight==` tokenizer and a live-but-banned underline
  mark both ship. `taskItemPromotion.test.ts` asserts on the parsed document
  and `e2e/notes.spec.ts` drives the real keystrokes. Do not "fix" a future
  regression here by loosening the Todo predicate to match literal
  `[ ] text` bullets; that was ruled out in M6.

- **Promoting a bullet lifts it out of an enclosing blockquote, while
  `TaskItem`'s own rule keeps the blockquote in the analogous case.** Accepted,
  not endorsed — nothing is lost and the parent survives, which beats the
  defect. Pinned by a PAIR of tests, one for each rule, so the divergence is
  checked on every run rather than asserted in prose.

- **A nested bullet promoted with `[ ] ` is lifted to the top level, losing
  its indentation.** Accepted for the same reason as the blockquote case:
  nothing is lost and it beats the defect. Pinned by a test.

- **`1. [ ] milk` inside an ordered list does not promote**, because a
  `taskItem` cannot live in an `orderedList`. Fail-safe — the user keeps a
  plain ordered-list item rather than losing anything — and pinned by a test.

- **`toggleTaskList()` DOES split a bullet list correctly when promoting a
  single middle item** — the neighbours survive as plain bullets. This was an
  open question in the M7 spec; the answer is recorded here so nobody
  re-derives it by trial and error.

- **Registration order does not decide which input rule wins FOR THIS PAIR —
  that is not a general law.** `@tiptap/core`'s input-rules runner
  (`InputRule.ts`) is `let matched = false; rules.forEach(rule => { if
(matched) return; ...; if (handler === null || !tr.steps.length) return; ...
matched = true })`: once any rule commits steps, `matched` is set and every
  later rule in the array is skipped for that keystroke — order is load-bearing
  in general. `TaskItemPromotion` and `TaskItem`'s own rule are the one pair
  where order is provably immaterial, because they decline in exactly
  complementary cases (one fires only inside an existing `listItem` in a
  `bulletList`, the other only outside one), so at most one of them ever
  commits steps for a given keystroke regardless of which is checked first.
  Verified by moving `TaskItemPromotion` above `TaskList`/`TaskItem` and
  watching every test in `taskItemPromotion.test.ts` stay green — that result
  does not generalize to any other pair of rules. A rule "declines" by
  returning `null` from its handler (the `handler === null` half of the guard
  above); `TaskItemPromotion` uses that half. The `!tr.steps.length` half is a
  separate guard for a handler that returns non-null but happens not to have
  queued any steps — not the mechanism this rule relies on.

### Tables

- **Tables are real nodes, and `RawTable` is gone.** M8c replaced the fallback
  with `@tiptap/extension-table`, whose official node already ships a Markdown
  tokenizer, parser and serializer — which is the only reason this was worth
  doing rather than leaving tables as preserved text. Hand-writing a GFM
  serializer would have been a second Markdown implementation, this project's
  signature defect. `rawTable` must NOT be re-registered: it would claim the
  `table` token an extension above already handles.

- **`MarkdownTable` wraps the official node to fix two serializer defects, and
  BOTH are invisible to an idempotence-only assertion.** This is the clearest
  live instance of the round-trip suite's documented blind spot.
  - **Pipes in cell text were not escaped.** `| x \| y | z |` parses to two
    cells and serialized back to `| x | y | z |` — three cells in a two-column
    table — and normalizing THAT dropped `z`. Real data loss, and a regression
    against the old fallback, which preserved such a table byte-for-byte.
    **Timing is the whole trick and the obvious fix is wrong:** escaping the
    document's text nodes before rendering fails, because the text renderer runs
    afterwards and escapes the backslash, producing `x \\| y` — the same lost
    cell by a longer route. The escape wraps `renderChildren` so it applies to
    already-rendered cell Markdown.
  - **A table gained a blank line above and below itself.**
    `renderTableToMarkdown` wraps its output in newlines and `MarkdownManager`
    already joins blocks with one, so `# Shopping\n\n| item` became
    `# Shopping\n\n\n| item`. Stable, so every idempotence check passed.
    Trimming only the table's own edges is deliberately narrower than a general
    "collapse blank runs" pass in `serializeMarkdown`, which would corrupt a
    fenced code block containing blank lines.

- **A table is NORMALIZED, not preserved.** Cells are padded to the column's
  widest content and the separator row is rewritten, so a table typed unpadded
  changes shape on the user's first edit. This does not violate "opening a note
  produces no write" — that holds because `NoteEditor` seeds autosave from the
  mounted editor's own reading — but it does mean the stored text changes once,
  on the first real edit. Accepted: editable tables are worth it.

- **The alignment row is WIDER than the columns it describes, and the fidelity
  string pins that.** The serializer writes `max(3, width)` dashes and then adds
  the alignment colon outside that count, so `| left | right |` gets
  `| :---- | -----: |`. Do not "tidy" the pinned string; fidelity's job is to
  state exactly what the serializer produces, and a prettier value would be
  false.

- **Tables need STRUCTURAL assertions, in `table.test.ts`.** A real table and a
  preserved block of source produce identical Markdown, so no round-trip test
  can tell them apart — the same blind spot that let a dead `==highlight==`
  tokenizer and a live-but-banned underline mark ship in M4. That file asserts
  the schema registers the four nodes, that `rawTable` is absent, and that
  parsing yields header/body rows with paragraph-wrapped inline content.

### Tag pills and activation

- **`parseTags` is the deduped name-only view of `findTagRanges`, and the tag
  grammar exists in exactly one place.** The scanner always computed each
  tag's start and end and threw them away; M7.6 stopped throwing them away
  rather than writing a second parser for the editor, which would have been
  two implementations of one grammar — this project's signature defect.
  `parseTags` is now defined as
  `[...new Set(findTagRanges(x).map(r => r.tag))]`, so the agreement describe
  block in `parseTags.test.ts` is tautological while that one-line definition
  holds — it asserts the exact same expression the implementation already is,
  so it does not, by itself, prove the grammar's behaviour is preserved. What
  it does do is act as a tripwire: the instant someone forks the two into
  separate implementations, the tautology breaks and the test starts
  asserting something real. Behaviour preservation of the grammar itself is
  guarded separately, by every other describe block in `parseTags.test.ts` —
  the corpus of cases that predates M7.6 and asserts `parseTags`' actual
  output against expected tag lists.

- **The tag pill is a ProseMirror DECORATION, never a mark.** The document is
  untouched, so no schema, serializer or round-trip path is involved and a
  pill can never survive into a note's Markdown. The cost is that **every
  round-trip test in this project is blind to whether the plugin runs at
  all** — the same blind spot that let a dead `==highlight==` tokenizer and a
  live-but-banned underline mark ship in M4. `tagPill.test.ts` asserts on the
  decoration set itself and is the only thing that can catch a dead plugin.

- **`maskedBlockText` emits one character per document position, and the
  plugin's position arithmetic depends on it.** `node.textContent` cannot be
  used: a `hardBreak` contributes no characters but occupies a position, so
  every offset after it would shift and pills would paint the wrong
  characters. Non-text inline nodes contribute one mask character per
  position, which is also correct — a line break must terminate a tag.
  **A `hardBreak` itself contributes `'\n'`, not the mask character** — an
  earlier draft of the plan masked it, and that was wrong: a hard break
  genuinely is a line break, so serializing the paragraph makes `parseTags`
  find the same tag `maskedBlockText` must also see. A newline is whitespace,
  so it both terminates a tag and permits one to start — the opposite of what
  the mask character is for — but it is still exactly one character, so the
  one-character-per-position invariant survives. **A known limit, accepted,
  not fixed:** a paragraph containing both a fence marker and a hard break
  suppresses the pill while `parseTags` still yields the tag — the tag works,
  only the pill is missing, the same shape as the mark-boundary limit below.

- **`maskedBlockText` masks the FIRST character of every marked text run, and
  `code` whole.** All six marks in this schema — `bold`, `italic`, `strike`,
  `highlight`, `link`, `code` — serialize with an opening delimiter (`**`,
  `*`, `~~`, `==`, `[`, `` ` ``), verified against the real serializer. So the
  first character of a marked run is preceded by `*`, `~`, `=`, `[` or a
  backtick in the Markdown, never by whitespace, and `parseTags` refuses to
  start a tag there. The document contains no such character, so without this
  the plugin accepted `**#bravo**` as the tag `bravo` while the index —
  correctly — held nothing. **That is a pill asserting something false about
  the user's data**: the user bolds a tag to emphasise it, the pill stays, and
  the tag silently vanishes from the sidebar, its counts and tag filtering.
  Strictly worse than a missing pill, and the inverse of the fail-safe
  direction the spec's known limit assumed. Masking the run WHOLE was rejected:
  `**see #work here**` puts the `#` after a space, a tag really is there, and
  removing the pill trades one disagreement for another. One character also
  keeps the one-character-per-position invariant, and an astral first character
  is replaced code-unit-for-code-unit rather than by a single mask.

- **The pill set and the tag index are asserted EQUAL, over a corpus, as one
  property — `tagAgreement.test.ts`.** That the two agree is the milestone's
  central claim, and until M7.6's Task 6 nothing anywhere compared them: each
  side was tested against its own expectations, which is how the `**#bravo**`
  defect survived five task reviews and a whole-branch review. Both halves come
  from the real pipeline — decorations read back through
  `doc.textBetween`, and `parseTags` over `serializeMarkdown(editor.getJSON())`,
  exactly what `RichEditor.getMarkdown` produces. **Any new construct, mark or
  masking rule belongs in that corpus**, the same way a new Markdown construct
  needs entries in both the fidelity and stability suites.

- **A known limit, accepted and NOT fully fail-safe: a mark delimiter landing
  inside or immediately after a tag's own characters.** `*`, `~` and `=` are
  not tag boundaries, so `parseTags` reading `**see #work**` yields the tag
  `work**`, while the pill covers `#work` — **a pill of the wrong extent, not
  merely a missing one.** The spec (design doc line 81) describes the residue
  as fail-safe; after Task 6 that is only partly true, and this bullet is the
  correction. Same shape for `*…*`, `~~…~~`, `==…==`, for `#work**bold**`
  (indexes as `work**bold**`), and for a tag continuing into a mark —
  `x #wo**rk** y` pills `#wo` and indexes `wo**rk**`. **The `link` case is
  worse and is ONE of two surviving lying-pill classes** (the other is the
  whitespace hoist in the next bullet): `[see #work](https://e.com)` indexes
  NOTHING, because `](https://…)` puts an empty `/`-segment in the name and
  `normalizeTag` rejects the whole candidate — so the pill is there and the
  tag is not. No editor-side masking can close any of this: agreement would
  need the pill to cover characters the document does not contain, and the
  cause is a pre-existing parser/serializer interaction that predates pills and
  is visible in the sidebar with or without them. Closing it means changing
  `parseTags`' grammar, which reorganises every existing user's sidebar.
  A code span is the control that proves the diagnosis: backticks ARE masked on
  both sides, so a tag continuing into an inline code span agrees exactly. All
  of it is pinned with its real values in `tagAgreement.test.ts`'s `RESIDUAL`
  block.

- **The second lying-pill class: a mark applied over a run's own LEADING
  WHITESPACE, which the serializer hoists outside the delimiter.** This is why
  `maskedBlockText`'s docblock says a marked run's first character is only
  _usually_ delimiter-adjacent — as an absolute the claim is false. Measured:
  bold over `'  #work'` between `pre` and `post` serializes to
  `pre  **#work**post`, so the space moved OUT of the delimiter; the pill
  covers `#workpost` and the index holds nothing. Identical for `italic`
  (`pre  *#work*post`), `strike` (`pre  ~~#work~~post`), `highlight`
  (`pre  ==#work==post`) and `link` (`pre  [#work](https://e.com)post`).
  `'   #work '` gives `pre   **#work** post`, pill `work`, index none; a run of
  `'  #work'` alone in a block gives `  **#work**`, same. **The precondition is
  two or more leading whitespace characters** — with exactly one space, or one
  tab, the first-character mask covers it and the two views agree, and `code`
  is masked whole so it agrees too. Pre-existing (it lied before the
  first-character masking as well) and unreachable from Markdown: only applying
  a mark over leading whitespace in the UI produces it, which is why no
  Markdown-sourced corpus entry could catch it and why its fixtures in
  `tagAgreement.test.ts` are built node-wise.

- **The spec's own account of its known limit is wrong, and the corpus pins the
  truth instead.** Design doc line 81 says a tag split across a mark boundary
  (`#wo` bold, `rk` plain) still indexes and only loses its pill. It does not:
  `**#wo**rk` puts `**` before the `#`, so `parseTags` rejects it too and the
  two views agree. Do not restore the spec's wording from prose.

- **The pill lifts while the cursor is inside its tag.** Without it, typing
  `#w`, `#wo`, `#wor` re-pills on every keystroke and character widths jump
  under the cursor. Intersection, not containment: a caret at either edge
  counts as inside.

- **The `#` stays visible inside the pill.** This app does not hide Markdown
  syntax, and the hash is the only thing distinguishing a tag from the heading
  that `# ` — one space different — produces.

- **`--bear-tag-fill` is a separate token from `--bear-selected`, and the two
  deliberately diverge in Paper only.** Same hue, different alpha: Paper's
  `selected` at 0.11 is right for a selected row — a whole band that only has
  to read as present — and too weak for a pill, which is a few characters of
  inline text and has to read as a discrete chip. At 0.11 the pill read as a
  highlighted word. Paper is 0.16; Ink's 0.18 was already comfortable, so the
  two tokens coincide there. Like every token it must appear in all three
  blocks — `:root`, `:root[data-theme='dark']`, and the
  `prefers-color-scheme` block — which `scripts/sourceLint.test.ts` asserts
  value-for-value across the two dark ones.

- **The pill's horizontal padding is asymmetric, and that is not a typo.**
  `0.05em 0.15em 0.05em 0.25em`. Equal padding pushed a following comma or
  full stop visibly away from the word it belongs to — `#friday ,` — because
  a tag ends at punctuation far more often than it begins after it. The
  leading side keeps its full inset so the `#` reads as part of the chip.
  A negative inline margin was considered and rejected: it hides the gap by
  letting the pill overlap its neighbouring characters.

- **Plain click on a tag pill edits; Mod-click activates.** Bear filters on a
  plain click, and this is a deliberate divergence: Bear can afford it because
  its tag autocomplete makes mistyped tags rare, while this app has none, so
  editing a tag in place is the normal repair path and a pill that defended
  itself against being edited would be worse than an inert one. **If
  autocomplete ever ships, revisit this ruling** — it is the premise the
  divergence rests on.

- **Mod is Cmd on Apple platforms and Ctrl elsewhere, never `metaKey ||
ctrlKey`.** Ctrl-click on macOS is the context-menu gesture; accepting both
  means one gesture opens a menu AND changes scope. `isMacOS` from
  `@tiptap/core` decides. Getting this wrong is invisible on Linux CI, so
  `tagPill.test.ts` asserts both branches.

- **Activation is handled in `handleDOMEvents.mousedown`, not `handleClick`.**
  ProseMirror does not place the caret itself on a plain click — the browser
  moves the DOM selection natively during `mousedown` and ProseMirror reads it
  back. By `handleClick` (which runs on `mouseup`) the caret has already moved,
  suppression has already lifted the pill, and the thing the user clicked has
  vanished under the cursor. `event.preventDefault()` on mousedown is the only
  point that stops it.

- **`tagRangeAt` hit-tests the grammar, never the decoration set.** A tag the
  caret sits inside has no pill; if activation followed the pills, the same
  gesture would work or not work with nothing on screen to explain the
  difference. Behaviour must not depend on invisible state. It shares
  `tagHitsIn` with `tagDecorations`, so the `blockPos + 1 + offset` arithmetic
  exists once — perturbing it fails both suites, which is the proof.

- **`tagRangeAt` resolves the clicked position to its own textblock; it does
  not walk the document.** `state.doc.resolve(pos)` already knows the
  position's ancestry, so the containing block is reachable directly and the
  gesture costs the same on a 900-block note as on a one-line one — the
  whole-document `descendants` walk it replaced measured 1.5 ms median / 5.2 ms
  worst on 100 KB, imperceptible but proportional to note size where the spec
  said constant. The two are behaviourally identical (document positions are
  unique, so no other block's ranges can contain `pos`), which means **this
  change is pinned by no behavioural test and could be reverted silently.**
  What IS pinned: `$pos.before()` must take the position of the _immediate_
  textblock, not an outer one — a paragraph inside a blockquote starts one
  position later than the blockquote does, and `before(1)` shifts every offset
  by the difference (a `tagPill.test.ts` test fails on exactly that). And
  `!$pos.parent.isTextblock` is load-bearing twice: it rejects what cannot hold
  a tag, and it is what keeps `before()` from throwing at depth 0, where the
  parent is the document itself. An explicit `$pos.depth === 0` clause was
  written alongside it and then removed — `doc.isTextblock` is false, so no
  injection could make that clause fail, and an unfalsifiable branch is a
  defect here.

- **Activating a tag the index does not hold does nothing.** M7.6 ships two
  classes of lying pill. Setting a scope for one would trip the vanished-tag
  effect and bounce the user to All Notes — a click that visibly throws them
  somewhere they did not ask to go. The same handler returns early while
  `tree.nodes` is `undefined`, because that means "loading", not "no tags".

- **`onActivate` returns a boolean, and the app's answer — not the plugin — is
  what consumes the event. A Mod-click either filters, or behaves exactly like
  a plain click. Never nothing.** The plugin originally called
  `preventDefault()` before asking, which made every case the app declines cost
  the user the caret as well as the filter: the click simply vanished. That is
  not only the two lying-pill classes and a trashed note's pills — **a tag
  typed within the last ~350 ms is unactivatable too**, because the index is
  written by autosave (`AUTOSAVE_DELAY_MS = 300`) and the guard correctly
  declines a tag that is not in it yet. Measured before the fix: 50/150/300 ms
  after typing → nothing at all; 400/500/700 ms → filtered. So the plugin now
  asks first and consumes second, and `AppShell.handleActivateTag` returns
  `false` on both refusals and `true` after setting the scope. **`RichEditor`'s
  ref-backed wrapper must PROPAGATE that boolean** — the "simplification" to a
  statement body returns `undefined`, which reads as declined and silently
  disables the whole feature while every callback still fires; pinned by a
  `RichEditor.test.tsx` test asserting both directions.

- **The boolean gate made the `null`-`onActivate` contract look redundant, and
  the test that guards it had to change shape to stay falsifiable.** With an
  unconditional wrapper and no `onActivateTag` prop, `activateRef.current` is
  `undefined`, `undefined === true` is `false`, and the app-declined path
  produces a byte-identical `handled: false` / `defaultPrevented: false` — so
  deleting the `null` guard left 1034/1034 green, one commit after the same
  injection failed a test. The two exits are still genuinely different: `null`
  declines **before** the hit test, a `false` answer **after** it. The test
  therefore spies on `posAtCoords` and asserts the plugin never even asked
  where the click landed; the decline-by-answer test asserts the mirror. **Any
  future guard added in front of this handler needs the same treatment** —
  outcome-only assertions cannot separate two exits that produce the same
  outcome.

- **The tooltip stays optimistic on pills that cannot work, and that is
  inherent.** Both lying-pill classes and every pill in a trashed note light up
  under the modifier and read "Cmd-click to filter by this tag", then decline.
  The editor deliberately learns nothing about scopes or the tag index, and the
  guard that knows lives downstream of the decoration, so making the copy
  honest means pushing index knowledge into the editor — the boundary M7.6 and
  M7.7 were both careful not to cross. After the boolean contract above the
  _click_ is honest (it places the caret, exactly like a plain click); only the
  copy still promises. Do not chase this further without a design that crosses
  that boundary deliberately. One related latency with no live instance:
  `RichEditor` passes `activateHint` unconditionally, so a `RichEditor`
  rendered with no `onActivateTag` — where `onActivate` is `null` and the
  gesture is genuinely off — would still paint promising tooltips. Every live
  call site supplies the prop; if one ever does not, gate the hint on the same
  condition.

- **The modifier affordance is a DOM attribute set through a ref, never React
  state.** `data-mod-held` on the editor's outer element; setting state on
  every `keydown` would re-render the editor subtree on every keystroke the
  user types. It is derived from each event's own modifier flags on both
  `keydown` and `keyup`, and cleared on window `blur` — hold Cmd, press Tab to
  leave the window, and the `keyup` never arrives, leaving pills claiming to
  be clickable while a plain click edits. **This is convention enforced by
  nothing** — there is no lint rule or test forbidding a future edit from
  routing this through `useState` instead, the same gap the
  `@tiptap/markdown` single-importer rule already names for itself.

- **`editorExtensions` is `buildEditorExtensions()` with no options**, so
  `getSchema(editorExtensions)` and `computeRecognizedHtmlTags()` are
  unaffected by anything the app injects. An `Extension` registers nothing in
  the schema, and the options must never be able to change that. **This too is
  convention enforced by nothing**: no test asserts that a future option added
  to `TagPillOptions` (or any sibling extension) leaves the schema untouched.

- **The tooltip's locale is frozen at mount.** `RichEditor` builds its
  extension array once, so switching locale leaves every pill's `title` in
  the old language until the editor remounts — which a note switch does
  anyway, since `NoteEditor` is keyed by note id. Fixing it properly means
  either recreating the editor on locale change (throwing away undo history)
  or turning `activateHint` into a getter, changing an option shape that is
  now pinned by tests. Accepted, not a defect.

- **`RichEditor` passes `null` for `onActivate` when no `onActivateTag` prop
  is supplied, and that is load-bearing.** With a non-null callback the
  plugin believes someone is listening, so a Mod-click calls
  `preventDefault()` and swallows the event — the user gets neither filtering
  nor the caret placement a plain click would have given. The decision is
  made once, in the `useState` initializer, matching the plugin's read-once
  semantics.

- **Under jsdom `navigator.platform === ''`, so `isMacOS()` is false on every
  machine, including a Mac.** Any test of a platform-dependent branch must
  stub `navigator.platform` explicitly before the code under test runs — for
  `RichEditor` that means before render, since `isMacOS()` runs inside a
  `useState` initializer — and restore it in a `finally`. This milestone
  shipped two tests named for platform branches that could never execute
  them.

### Design tokens, theme, and layout

- **M8 owns theme switching.** M2 only set the system default via a
  `prefers-color-scheme` media query. An explicit `data-theme` on the root overrides
  it — that is the seam the picker will use. Do not simplify the
  `:root:not([data-theme='light'])` selector.

- Pane widths are **durable** (settings table), not Zustand state. Zustand is
  reserved for genuinely ephemeral state and has not been added yet.

- **The font families are `'Pretendard Variable'` and `'JetBrains Mono
Variable'`.** `tokens.css` named `'Pretendard'` from M2 to M5.5 with no
  `@font-face` anywhere, so the app silently ran on `system-ui` for five
  milestones. Importing the package alone would not have fixed it — the family
  name must match too. `scripts/fonts.test.ts` compares the token's family
  against the families the shipped stylesheet declares; that is the only form
  of the assertion that can fail.

- **Colour literals outside `tokens.css` fail `npm test`** (not the build), via
  `scripts/sourceLint.test.ts`. The scan is a documented heuristic scoped to
  CSS files and `className`/`style` regions, because `#face` and `#dad` are
  valid hex and valid tags.

- **Both dark theme blocks must stay token-for-token identical**, asserted by
  `scripts/sourceLint.test.ts`, which compares values and not just key sets. A
  token present in `:root[data-theme='dark']` but missing from the
  `prefers-color-scheme` block is correct for a user who picked dark and wrong
  for a user whose OS is dark — invisible to every other test.

- **Motion lives in two duration tokens, never per-component**, so one
  `prefers-reduced-motion` block covers animations added later.

- **`danger` and `focus` are separate tokens from `accent`** though all three
  are identical in both shipped themes. An M8 theme with a green accent must
  not get a green delete button.

- **Tailwind v4 has no `--duration-*` theme namespace.** Durations are written
  `duration-[var(--bear-duration-fast)]`. Adding a `--duration-fast` theme key
  does not produce a `duration-fast` utility.

- **`--bear-faint` was darkened to clear WCAG 3.0 and must not be lightened for
  aesthetics.** Paper `#88857d` measures 3.21:1 on `--bear-sidebar`; the
  original `#9c988f` measured 2.51:1 and failed. Ink is `#7b766e` at 3.40:1.
  `faint` carries counts and timestamps, so 3.0 is already the relaxed bar.
  **No test can catch this** — contrast over alpha-composited overlays needs a
  real cascade and jsdom has none, so the ratios are measured by hand and
  recorded in `docs/design/DESIGN-bear-web.md`.

- **Exactly two files may suppress the focus outline**, allowlisted in
  `scripts/sourceLint.test.ts`, each mapped to a marker string proving it
  supplies its own indicator: `Resizer.tsx` (`group-focus-visible:` accent
  hairline) and `RichEditor.tsx` (the text caret). The test asserts the
  suppressor set first, so a third file fails before the marker check runs.
  `RichEditor`'s suppression was an undocumented accident until M5.5.
  **Neither suppression actually rendered until M7.5**, and the marker-string
  check is why it went unnoticed for two milestones: `src/styles/index.css`
  declared the global `:focus-visible` ring outside any cascade layer, and an
  unlayered rule beats every rule inside a named layer regardless of
  specificity — including `focus-visible:outline-none` in both allowlisted
  files. `scripts/sourceLint.test.ts` can only see that the marker string is
  present in the source; it cannot see what's actually painted. The fix wraps
  the global rule in `@layer utilities`, the same layer Tailwind's utilities
  occupy, which makes it a normal, overridable cascade citizen instead of
  always winning. That alone was enough for `Resizer` — its compiled selector
  (`.focus-visible\:outline-none:focus-visible`) has higher specificity than
  the bare `:focus-visible` ring. `RichEditor` needed a second change:
  its suppression was a bare `outline-none` (no `focus-visible:` prefix),
  which compiles to the _same_ specificity as the global ring, so equal-layer
  source order — not specificity — decided, and the ring still won. It now
  reads `focus-visible:outline-none`, matching `Resizer`'s pattern.
  `e2e/appearance.spec.ts` now asserts computed `outlineStyle` in a real
  browser on both suppressed elements and, as a control, on an ordinary
  button that is not in the allowlist — the only kind of assertion that can
  actually fail here.

- **`--bear-canvas` is the ground the three panes float on, and it is what
  `body` paints.** A browser tab has no window chrome, so depth is what
  separates the panes — the role Bear's rounded macOS window plays. Panes carry
  `shadow-popover` and no border: hard borders would compete with the 1px
  dividers used inside each pane, and separating panes by depth while
  separating rows by line keeps the two jobs distinct. `bg-canvas` on `<main>`
  is redundant with `body`'s own paint and is pixel-identical whether present
  or not — measured twice, independently, during M7.5. It stays for a
  self-contained shell, but a fault injection meant to prove "a pane is a
  card" must target a PANE's own `bg-*` class or `rounded-lg`, never
  `<main>`'s `bg-canvas`; that injection is a no-op.

- **The gap between cards IS the resizer.** Before M7.5 it was a 1px hairline
  whose hit box was widened with a negative margin that cancelled out in flex
  layout. `e2e/smoke.spec.ts`'s hit-target test was rewritten in M7.5 because
  the contract changed — that is the one licensed instance; a failing
  geometry or role test during a restyle is otherwise a behaviour report, not a
  stale expectation. The resizer carries no permanent hairline or highlight at
  rest; the 16px of visible canvas between cards (4px pane inset + 8px
  resizer + 4px pane inset, measured at 1440x900) is itself the resting cue,
  ruled sufficient rather than adding a dedicated visual affordance.

- **Headings keep `--bear-text`.** `--bear-accent` and `--bear-danger` hold the
  same value in both shipped themes, so accent-coloured headings would make one
  colour mean both "heading" and "delete forever", and a page of red headings
  reads as a warning notice. The accent is for links, checkboxes, highlight,
  selection and focus.

- **Both editor toolbars float; they are not bars in the flow, and their
  placement lives in `RichEditor`, not in either toolbar.** From M4 to M7.5 they
  were full-width strips welded to the pane's top and bottom edges, which
  measurement against Bear identified as the single largest reason the editor
  read as a web page rather than an app (see the measured comparison in
  `docs/design/DESIGN-bear-web.md`). `TopControls`, `InfoPanel` and
  `BottomToolbar` are now bare groups of controls with no layout of their own,
  and `RichEditor` positions all three, so the pill offsets are stated once
  together and cannot drift apart. Three consequences that are load-bearing
  rather than stylistic:
  - **The writing surface's `pt-12`/`pb-24` is a reserve, not spacing.** The
    pills overlay the prose, so without the bottom reserve the last line of
    every note sits permanently behind the formatting bar with no way to scroll
    it clear — and the note still round-trips perfectly, so nothing but a
    computed-style test can see it. `e2e/appearance.spec.ts` asserts the reserve
    covers each pill's actual reach into the pane, so it stays correct when a
    toolbar's height or inset changes.
  - **The positioning wrappers are `pointer-events-none` with
    `pointer-events-auto` on the pill.** Each wrapper spans the pane's full
    width; without this the top wrapper would swallow every click on the first
    line of prose beneath it.
  - **`EditorContent` comes FIRST in the DOM**, so tab order and screen-reader
    order reach the note before its formatting controls. Visual stacking is
    `absolute` + `z-10` on the chrome, never source order.
    `BottomToolbar` keeps `w-fit max-w-full` with `overflow-x-auto`: it shrinks to
    its content at a comfortable width, so `scrollWidth === clientWidth` and no
    scrollbar appears, and is capped rather than overflowing the pane when eleven
    icon buttons no longer fit — at which point the toolbar's own `scrollLeft` is
    the scrolling container, not the pane's. Both halves were already pinned by
    `e2e/appearance.spec.ts` before the reshape and still are.

- **`--bear-line-width` caps the prose column, not the pane.** The editor pane
  still fills the window so the toolbars span it; only `.ProseMirror` is capped
  and centred. It sat declared-and-unused from M5.5 to M7.5, which is why the
  editor read as a web page rather than an app. `.ProseMirror` also needs an
  explicit `width: 100%` alongside the `max-width` clamp — it is a flex item
  inside `EditorContent`'s column-direction wrapper, and a flex item's auto
  cross-axis margins (`margin-inline: auto`, needed to center the clamped
  column) suppress default stretch alignment, so without the explicit width
  the column shrinks to fit its content instead of filling the pane and then
  clamping.
  **It was wired in M7.5 and STILL inert in practice until M8**, because `56em`
  resolves to 896px while the editor pane at 1440x900 is 840 wide — so the
  rendered column was 792 and the clamp never engaged at the window size every
  screenshot is taken at. The value is now the MEASURED one: Bear renders a
  643pt column at 16pt, which is `40em`. Bear's own typography panel reports its
  line width as `56 em` — the number this token carried for three milestones —
  so **do not restore 56 on the strength of Bear's label**; Bear's `em` there is
  not a CSS `em` and the missing 16em is unexplained. Match what Bear renders.

- **`--bear-para-spacing` and `--bear-para-indent` are ADDITIVE, and all three
  editor typography tokens are now guarded by a test that drives them from the
  page.** Additive matches Bear's semantics: its 단락 간격 slider defaults to
  `0 em` and adds to the app's own base rhythm rather than replacing it, so at
  the shipped `0em` the render is byte-identical to before they were wired.
  Spacing is stated TWICE in `editor.css` — once on `> * + *` and again on the
  heading rule — because those two rules have equal specificity and the heading
  one wins on source order, so a heading would otherwise ignore the token
  entirely. The guard matters more than the wiring: a declared token no rule
  consumes is indistinguishable from a token that does not exist, Tailwind and
  CSS both emit nothing and say nothing, and this project has now shipped that
  defect three times (`--color-hover`, `--bear-line-width`, and these two).
  `e2e/appearance.spec.ts`'s "the editor typography tokens reach the rendered
  prose" sets each token from the page and asserts the render moves; all three
  halves were verified by fault injection, including restoring `56em`.

- **The tag pill sets `box-decoration-break: clone`.** A pill that wraps mid-tag
  otherwise gets ONE box sliced through the break — the fragment before it loses
  its right edge and radius, the one after loses its left — which reads as a
  rendering fault rather than a wrapped chip. Latent from M7.6 until M8 narrowed
  the measure to 40em, at which point a mid-tag wrap became common rather than
  rare.

- **`SearchField` suppresses the native `type="search"` cancel widget.**
  Chromium renders its own X inside a search input, which sat beside our own
  labelled clear button — two clear affordances in one freshly designed
  field. `type="search"` stays (it is what makes the `searchbox` role and its
  tests hold); only the native widget's rendering is suppressed.

### Export

- **Export renders through the EDITOR'S OWN SCHEMA, never a second Markdown
  pipeline.** `renderNoteBody` parses with `parseMarkdown` — the single importer
  of `@tiptap/markdown` — and serializes with ProseMirror's `DOMSerializer`
  against `getSchema(editorExtensions)`. So an export cannot disagree with what
  the editor shows, and the two-implementations-of-one-grammar defect never
  appears. Reaching for `marked` directly in export code would reintroduce it.

- **A construct with no node in the schema exports as its own Markdown source,
  and that is the fallback working.** A table becomes a `<pre data-raw-block>`
  of pipes in the exported HTML and PDF, exactly as it appears in the editor.
  Do not "fix" this in the export layer; it is the strongest argument for
  giving tables a real node, and fixing it downstream would make the export
  disagree with the editor.

- **Markdown export is the note's text VERBATIM.** No normalization, no
  re-serialization. The text is already canonical Markdown, so putting it back
  through the serializer could only change it, and an export that rewrites a
  byte of the user's own file is the one thing this must not do.

- **Export uses the LIVE editor text, not `note.text`.** The stored record lags
  the editor by the autosave debounce, so exporting it hands the user a file
  missing their last few seconds of typing. `NoteEditor.handleExport` reads
  `handleRef.current.getMarkdown()` and derives the title from that same text.

- **PDF is the browser's print pipeline, into a hidden same-origin iframe.**
  Printing the app's own window would need a print stylesheet that hides three
  panes, two floating pills and a dialog, and every future piece of chrome would
  silently need adding to it. Printing a separate document means the PDF is
  exactly what `renderNoteHtml` produced. The frame uses `visibility: hidden`,
  not `display: none` — a display-none frame has no layout in some engines and
  prints blank — is focused before printing (Safari prints the parent
  otherwise), waits on `fonts.ready` (a print started early lays out in the
  fallback face), and is removed in a `finally` so a throwing print cannot leak
  a whole second document per export.

- **The export stylesheet carries its own reset, and it is load-bearing.** The
  app gets one from Tailwind's preflight; a standalone file gets none, so the
  browser's default paragraph margin applies INSIDE a flex task item and the
  item stands three lines tall with its checkbox above its text. **The obvious
  assertion cannot see this**: the checkbox and its label still overlap
  vertically in the broken state, so the overlap check written first passed
  under fault injection. The test that works measures the item's height against
  its own computed `line-height`.

- **Export colours are read from the live cascade, never hardcoded.**
  `readExportTokens` resolves each token off `document.documentElement` at export
  time, which keeps colour literals out of `src/` as the token rule requires and
  makes an export carry whatever theme the user is looking at. The per-token
  fallbacks are CSS SYSTEM COLOURS (`canvas`, `canvastext`, `linktext`) rather
  than literals, so a renamed token degrades to the reader's platform palette
  instead of to a blank value — which would render an invisible page.

- **No backtick may appear inside `renderNoteHtml`'s template literal.** One
  terminates it, and the failure surfaces as a TypeScript syntax error pointing
  at a CSS comment. It happened once already, quoting a CSS declaration in a
  comment.

- **`export.html` and `export.pdf` are on the allowlist in `i18n.test.tsx` of
  keys legitimately identical across bundles.** Korean uses both acronyms
  verbatim. `export.markdown` is deliberately NOT on it — Korean does render
  that as 마크다운 — so the list stays a set of specific exceptions rather than a
  blanket exemption for the group.

### Accessibility

- **Never rely on a CSS `gap` to separate text for assistive tech.**
  Accessible-name computation concatenates text content and ignores gaps. M5.5
  shipped and reverted a regression where a tag row announced as `"work3"`
  instead of `"work 3"` after `SidebarRow` dropped an explicit space text
  node — the visual `gap-2` hid it completely, and the first fix attempt
  edited the failing tests to match. `src/ui/SidebarRow.tsx` carries an
  explicit `{' '}` and `ui.test.tsx` pins the resulting accessible name.

- **The pin button is a sibling of the row button, never nested.** A `<button>`
  inside a `<button>` is invalid HTML and unclickable in some browsers.

- **`NoteListItem` carries an explicit `aria-label`.** Its three sibling
  spans concatenate with no separator and accessible-name computation ignores
  the CSS gap, so the row announced as `"Groceries14:32milk"` from M3 until
  M7. The label also keeps highlight markup out of the name. Same root cause
  as the `SidebarRow` regression M5.5 caught and reverted — and, as there, a
  role-based test that fails during a restyle is reporting a behaviour
  change, not a stale expectation.

- **Every icon is `aria-hidden` and every icon-only control carries an
  `aria-label` from `useT`.** Replacing text with icons is the standard way to
  silently destroy a screen-reader experience, and this project has shipped
  that defect class twice — `SidebarRow` losing a space so a row announced as
  `"work3"`, and `NoteListItem` concatenating three spans into
  `"Groceries14:32milk"`.

- **Destructive controls keep their words.** "New note" is an icon button;
  "Move to trash", "Restore", "Delete forever" and "Empty trash" are text. An
  icon-only control for an irreversible action against a database with no
  server copy asks the user to recall a glyph before destroying data. This is a
  deliberate divergence from Bear, which hides destructive actions in menus.

- **The pin button reads by colour, not by glyph.** A `Pin`/`PinOff` glyph
  table keyed on `note.pinned` was tried and reverted: a slashed pin in the
  unpinned state reads as "pinning is unavailable" (the same grammar as a
  muted-mic or no-wifi glyph), not "click to pin". The button is always the
  `Pin` glyph, differentiated by colour; `aria-label` and `aria-pressed` carry
  the state for assistive tech.

### Testing and tooling conventions

- **Source-scanning tests live in `scripts/`, not `src/`.** `tsconfig.app.json`
  deliberately omits Node types; `tsconfig.node.json` already includes
  `scripts`.

- **A role-based test that fails during a restyle is reporting a behaviour
  change, not a stale expectation.** Editing it to match the new output is the
  same defect as asserting a class name. This is how the `SidebarRow` space
  regression above nearly shipped.

- **`e2e/appearance.spec.ts` is the only test in the project that can see
  "renders wrong", and it is deliberately RELATIVE where `smoke.spec.ts` is
  absolute.** Three defects shipped through a fully green 700+ test suite —
  the missing `--color-hover`, `Button`'s borderless-and-fill-less `default`
  variant, and the total absence of editor prose CSS — because the round-trip
  suite drives `MarkdownManager` with no DOM and the component tests assert
  document structure, never computed style. All five tests were verified by
  reintroducing each of those exact defects and watching precisely the
  intended test fail; any new one belongs there only if it fails under a
  fault injection. Assertions are relationships (a heading is larger than a
  paragraph, a checkbox's box overlaps its label's vertically) rather than
  pixel values, because M8's typography sliders move every absolute size by
  design — pinning them would turn M8 into a test-editing exercise, which is
  the failure mode M5.5 already hit once. `smoke.spec.ts` pins absolutes for
  the opposite and equally deliberate reason: a palette change _should_ cost
  a conscious edit.

- **`e2e/smoke.spec.ts` pins the shipped palette deliberately.** It is the only
  test proving the `prefers-color-scheme` cascade reaches a rendered pixel, so
  a token change SHOULD require a conscious edit there. It went stale for four
  tasks during M5.5 because e2e was not run on every restyle task.

- **`lucide-react` is imported only by `src/ui/Icon.tsx`, and that is enforced
  by `scripts/sourceLint.test.ts`.** The primitive fixes one stroke width, two
  sizes, and `aria-hidden` on every icon in the app. A second importer would
  compile and look fine, which is why this is a test rather than a comment —
  unlike the `@tiptap/markdown` single-importer rule, which is convention
  enforced by nothing.

- **A CSS attribute selector like `[role="region"]` does not match a
  `<section aria-label>`.** The "region" role there is implicit ARIA
  semantics — the browser computes it for accessibility, but never writes a
  `role` attribute into the DOM — so a raw `document.querySelectorAll` or
  `.closest()` call for that selector inside a Playwright `page.evaluate`
  silently returns nothing. **Every use of that selector in
  `e2e/appearance.spec.ts` was audited and corrected, not just the one being
  added.** Three call sites shared the identical broken selector: the
  pane-card test (`querySelectorAll`, empty array, loop ran zero times,
  passed vacuously whether or not any pane had a background), and two older
  tests — "a default button reads as a control at rest" and "the search
  field reads as a control at rest" — that used `.closest()`, got `null` back
  for the pane every time, and so compared a colour string to `null` instead
  of to the pane's actual background; that comparison is always true, so
  neither had ever caught a fill identical to its pane. All three now select
  on the attribute actually present, `section[aria-label]`; the two
  `.closest()` sites also assert the pane was found at all, so a null lookup
  fails loudly instead of quietly validating anything compared against it.
  **The reusable distinction: `page.getByRole('region')` is unaffected by any
  of this** — it queries the accessibility tree Playwright itself computes,
  not raw DOM attributes, so it sees the same implicit role a screen reader
  would. A CSS attribute selector inside `page.evaluate` sees only what is
  literally written in the DOM. Reach for `getByRole` there; a `[role="..."]`
  selector inside `evaluate` is a trap for exactly this reason.

- **A transparent background and "equal to the canvas colour" are not the same
  failure, and one assertion does not catch both.** A pane with no `bg-*`
  class computes a `backgroundColor` of `rgba(0, 0, 0, 0)`, a literal string
  that is never equal to the canvas's own `rgb(...)` value — so an equality
  check alone passes on a fully transparent pane, the exact defect it was
  meant to catch. The card test in `e2e/appearance.spec.ts` asserts both:
  not-transparent, and not-equal-to-canvas.

## Carried into M5b and M6

Real, deliberately deferred with a ruling. Full M3 reasoning is in
`.superpowers/sdd/2026-08-08-m3-notes/progress.md`; full M4 reasoning is in
`.superpowers/sdd/2026-08-09-m4-editor/progress.md`; full M5 reasoning is in
`.superpowers/sdd/2026-08-10-m5-tags/progress.md`; full M5.5 reasoning is in
the M5.5 progress ledger, gitignored and not carried forward — the items below
are what survived out of it. Fold these into the next plan rather than
rediscovering them.

- **A tag pill has no keyboard activation, deliberately.** Making a span inside
  a contenteditable focusable fights the editor for the selection and for Tab,
  and the tag sidebar is already a complete keyboard route to every filter.
  Recorded as a ruling rather than an omission.
- **The note list has no header naming the current scope.** Bear has one. The
  only on-screen indication of an active filter is the `aria-current` sidebar
  row, which is why activation reveals collapsed ancestors. A real header
  belongs with M8's polish.
- Tag rename and delete are still carried from M5b and unscheduled. So is
  syntax-visibility toggling — M5's original three-item list named it
  alongside the inline mark and rename/delete; M7.6 ruled only on the inline
  mark (a decoration, not a mark — see above), and the toggle itself remains
  unimplemented and unscheduled.
- **`usePaneWidths` writes `void settings.set(...)` with no flush**, so dragging
  a separator and reloading immediately can lose the width. Deferred because it
  costs a pane width rather than note content, and because `useAutosave` now has
  the general `beforeunload`/`visibilitychange` flush pair that should be
  extracted and shared rather than duplicated one-off.
- **The keyed-remount rule (`key={note.id}`) is currently unfalsifiable at the
  app level.** Removing the key from `AppShell`'s render of `NoteEditor` left
  all 14 pre-M4 e2e tests green: `useNotes` routes every selection change
  through a transient `undefined`, which unmounts/remounts `NoteEditor`
  independently of the key, masking its removal. Reproduced identically on the
  pre-Tiptap textarea, so this is pre-existing, not a Tiptap regression. The key
  is not wrong — it is defence in depth whose own app-level test cannot fail. A
  future milestone touching `useNotes`' selection handling should either close
  this gap or record why it remains open.
- **A tag tree row's own count and its children resolve as two independent live
  queries.** A previously-collapsed row can flash open for a frame before the
  collapsed-state query lands, and a rapid double-toggle click collapses to one
  logical toggle rather than two (it converges, so no test currently fails on
  it). Cheap to fix by joining the queries; not done because M5 had no user
  complaint to point at.
- **A tag key of `''`, or one with a leading slash, would vanish from the tree
  entirely** — not merely mis-parented, its note disappears from every list.
  Unreachable today because the TDD-pinned `parseTags` grammar never emits such
  a key, but a one-line defensive skip in `buildTagTree` would be cheap
  insurance against a future parser change reopening a data-loss-shaped bug.
- **`NoteEditor`'s seed-vs-editor-reading comparison would be sturdier if it
  captured the mounted editor's own text at mount** when `note.text === seedText`,
  the way the general autosave-seed rule already does, rather than trusting
  `seedText` and the editor to agree. Not reshaped at M5's end because the
  current failure mode is fail-safe (a stray note lingers, nothing is deleted),
  unlike the manager/schema divergence that motivated the general rule.
- **Editor typography is wired but has no slider.** M7.5 wired
  `--bear-font-size` and `--bear-line-height` into `.ProseMirror`
  (`--bear-line-width` is wired too, but that half of this item is resolved —
  see `--bear-line-width` above). What is still missing is the UI: nothing
  lets a user move these tokens, so M8 owns the typography sliders
  themselves, not the CSS wiring. M5.5's spec deferred editor typography
  deliberately.
- **`confirmPending` in `AppShell` clears its state and then awaits with no
  `try`/`catch`.** A rejected `purge` or `emptyTrash` closes the dialog and
  leaves the user believing the deletion succeeded. This matches the four
  sibling handlers (`handleTrash`, `handleRestore`, `handleTogglePin`,
  `handleCreate`), so it is a house pattern rather than a regression — but it
  is the worst place in the app for it, because the action is destructive,
  irreversible, and has no copy anywhere else. Worth raising to must-fix when
  a milestone adds any error surface.
- **The `current === undefined` half of `NoteEditor`'s `discard` condition is
  untested.** Removing it leaves all 31 tests in that file green. It exists so
  a double-discard is a no-op rather than a `TypeError`; `notes.purge` of a
  missing id is already a documented no-op, so the consequence is small — but
  a regression there would pass CI silently.
- **An intermittent Playwright resize-test flake.** Seen once during M5.5, not
  reproducible afterwards across three consecutive full runs (18/18 each). Not
  actionable without a failing artifact, but worth naming because `jsdom` has
  no `setPointerCapture` — Playwright is the _only_ coverage for pointer-drag
  paths, so a flake there is a hole in the one place that can test them. If it
  recurs, run that spec with `--repeat-each`.
- **Paper's `--bear-selected` at `rgb(207 59 44 / 0.11)` reads faint.** On the
  bottom toolbar's pressed toggles it is a light wash over white, and on some
  displays the pressed state reads mainly through the text-colour shift rather
  than the background. Ink's `0.18` alpha is comfortable. Raising Paper's alpha
  is a design call, and it ripples into `e2e/smoke.spec.ts`, which now pins the
  shipped palette deliberately.
- **`rounded-md`, `rounded-lg`, `shadow-popover` and `shadow-dialog` are
  provisioned but unused.** M5.5's spec names them for M6's `ConfirmDialog`.
  They are not dead code awaiting deletion; deleting them means M6 re-adds
  them.
- **`scripts/fonts.test.ts` ignores `font-weight` and `font-style`.** Its
  `declaredFamilies` collects every `font-family:` an `@font-face` block
  declares regardless of which face it belongs to, so a family declared _only_
  at a weight or style the app never uses would satisfy the check. Latent, with
  no live instance — Pretendard ships `font-weight: 45 920` normal and
  JetBrains Mono `100 800` normal, so every declared family is one the app can
  actually render.

## Working style

Each milestone runs: brainstorm → spec → written plan → subagent-driven execution
with a review after every task and a whole-branch review at the end. Plans live in
`docs/superpowers/plans/`; per-milestone execution ledgers live in
`.superpowers/sdd/<plan-name>/progress.md` (gitignored, local only) and record every
finding, ruling, and deferred item.

Reviews here are expected to verify by running code and injecting faults, not by
reading. Several real bugs — an unfalsifiable persistence test, a tag index that
disagreed with its own rebuild, a CI artifact upload that captured nothing — were
found only that way.

## Git

- Remote is SSH via a host alias: `git@github-valorjj:valorjj/bear-web.git`.
  `~/.ssh/config` maps plain `github.com` to a **different (work) account**, so
  `ssh -T git@github.com` reports the wrong user. Always test `git@github-valorjj`.
- Repo-local identity is `valorjj <30681841+valorjj@users.noreply.github.com>`.
  The plain gmail address is blocked by GitHub's private-email push protection.
  Global git config is the work identity and must stay untouched.
- The first 33 commits carry the work address. Left deliberately; not worth a
  force-push on a public repo.
