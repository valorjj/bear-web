# bear-web

A local-first, web-based notes app modeled on the Bear macOS app. Three panes
(tag sidebar / note list / editor), Markdown notes, organized by inline hashtags
rather than folders. No backend, no account — everything lives in the browser's
IndexedDB.

**Live:** https://valorjj.github.io/bear-web/
**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Plans:** `docs/superpowers/plans/`

## Status

| Milestone                        | State                  |
| -------------------------------- | ---------------------- |
| M0 scaffold, CI, Pages deploy    | complete               |
| M1 data layer (Dexie)            | complete               |
| M2 application shell             | complete               |
| M3 notes CRUD, textarea editor   | complete               |
| M4 editor                        | complete               |
| M5 tags                          | complete               |
| M5.5 design language             | complete               |
| M6 smart lists, trash management | next                   |
| M7–M9                            | search, themes, polish |

626 unit tests, 18 end-to-end tests. `main` is always green and auto-deploys.

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
- `src/features/notes/ScopeSidebar.tsx` is two hardcoded rows and **M6 deletes
  the file**. It exists so M3 can ship `trash` and `restore` with a path back.
  Do not grow it into a registry.
- `parseTags` lives in `src/data/tags/`, not `src/features/tags/`. It is
  injected at `src/data/repositories/index.ts`, and `src/data/` must not import
  from `src/features/`. It also genuinely is data-layer logic: it derives a
  database index. Feature code reaches the index only through
  `notes.listByTag` and `notes.allTagRows` — never Dexie directly. (The parent
  spec sketches the parser under `features/tags/`; the spec is wrong.)

## Rules that must not be silently reversed

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
- **IndexedDB cannot index booleans or nulls.** `pinned` is unindexed and filtered
  in memory — a `.where('pinned')` query throws at runtime, not compile time. The
  `trashedAt` index contains _only_ trashed notes, because IndexedDB omits
  null-valued records; that is why `.aboveOrEqual(0)` is the correct idiom.
- **The `noteTags` index reflects active notes only**, consistently across `trash`,
  `restore`, and `rebuildTagIndex`. Dropping the table and rebuilding from
  `notes.text` must always be safe.
- **Import is replace-only**, and validates fully before clearing anything, so a
  rejected import cannot destroy existing data.
- **M8 owns theme switching.** M2 only set the system default via a
  `prefers-color-scheme` media query. An explicit `data-theme` on the root overrides
  it — that is the seam the picker will use. Do not simplify the
  `:root:not([data-theme='light'])` selector.
- Pane widths are **durable** (settings table), not Zustand state. Zustand is
  reserved for genuinely ephemeral state and has not been added yet.
- **`NoteEditor` must be rendered with `key={note.id}`.** The remount is what
  makes an editor instance know exactly one note for its lifetime, so its
  unmount cleanup is a correct flush-on-switch. Removing the key reintroduces
  the entire class of "wrote note A's text over note B" bugs.
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
- **The font families are `'Pretendard Variable'` and `'JetBrains Mono
Variable'`.** `tokens.css` named `'Pretendard'` from M2 to M5.5 with no
  `@font-face` anywhere, so the app silently ran on `system-ui` for five
  milestones. Importing the package alone would not have fixed it — the family
  name must match too. `scripts/fonts.test.ts` compares the token's family
  against the families the shipped stylesheet declares; that is the only form
  of the assertion that can fail.
- **Colour literals outside `tokens.css` fail the build**, via
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
- **Source-scanning tests live in `scripts/`, not `src/`.** `tsconfig.app.json`
  deliberately omits Node types; `tsconfig.node.json` already includes
  `scripts`.
- **Never rely on a CSS `gap` to separate text for assistive tech.**
  Accessible-name computation concatenates text content and ignores gaps. M5.5
  shipped and reverted a regression where a tag row announced as `"work3"`
  instead of `"work 3"` after `SidebarRow` dropped an explicit space text
  node — the visual `gap-2` hid it completely, and the first fix attempt
  edited the failing tests to match. `src/ui/SidebarRow.tsx` carries an
  explicit `{' '}` and `ui.test.tsx` pins the resulting accessible name.
- **A role-based test that fails during a restyle is reporting a behaviour
  change, not a stale expectation.** Editing it to match the new output is the
  same defect as asserting a class name. This is how the `SidebarRow` space
  regression above nearly shipped.
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
- **`e2e/smoke.spec.ts` pins the shipped palette deliberately.** It is the only
  test proving the `prefers-color-scheme` cascade reaches a rendered pixel, so
  a token change SHOULD require a conscious edit there. It went stale for four
  tasks during M5.5 because e2e was not run on every restyle task.

## Carried into M5b and M6

Real, deliberately deferred with a ruling. Full M3 reasoning is in
`.superpowers/sdd/2026-08-08-m3-notes/progress.md`; full M4 reasoning is in
`.superpowers/sdd/2026-08-09-m4-editor/progress.md`; full M5 reasoning is in
`.superpowers/sdd/2026-08-10-m5-tags/progress.md`. Fold these into the next
plan rather than rediscovering them.

- **The tag pill mark and rename/delete are M5b.** M5 shipped the parser, the
  index, the tree, the sidebar, and seeded creation; it never made `#tag` its
  own inline mark, never let a tag be renamed or deleted in bulk, and never
  added syntax-visibility toggling. Not a defect — the M4/M5 specs scope this
  out deliberately.
- **Deleting a blank note purges it rather than trashing it**, silently. The
  Delete button is irreversible there and identical everywhere else. Defensible
  under the blank-note rule, but M6 owns trash management and should decide.
  (M5's seeded-note purge, above, is the same mechanism applied to a note that
  is empty except for its seeded tag.)
- **A blank note open across a reload is never discarded**, because
  `beforeunload` only flushes and does not unmount. Spec-compliant as written; a
  startup sweep of empty notes would close it and belongs to M6.
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
- **Editor typography is declared but not wired.** `--bear-font-size` and its
  siblings sit in `tokens.css` unused while `RichEditor`'s contenteditable is
  `text-sm`. M8 owns the typography sliders and must wire the tokens, not
  merely add UI. M5.5's spec deferred editor typography deliberately.

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
