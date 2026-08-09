# bear-web

A local-first, web-based notes app modeled on the Bear macOS app. Three panes
(tag sidebar / note list / editor), Markdown notes, organized by inline hashtags
rather than folders. No backend, no account — everything lives in the browser's
IndexedDB.

**Live:** https://valorjj.github.io/bear-web/
**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Plans:** `docs/superpowers/plans/`

## Status

| Milestone                      | State                                    |
| ------------------------------ | ---------------------------------------- |
| M0 scaffold, CI, Pages deploy  | complete                                 |
| M1 data layer (Dexie)          | complete                                 |
| M2 application shell           | complete                                 |
| M3 notes CRUD, textarea editor | complete                                 |
| M4 editor                      | complete                                 |
| M5 tags, smart lists           | next                                     |
| M6–M9                          | trash management, search, themes, polish |

347 unit tests, 16 end-to-end tests. `main` is always green and auto-deploys.

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

## Architecture boundaries

- `src/ui/` holds presentation primitives. It must import **nothing** from
  `src/app/`, `src/data/`, or `src/i18n/`. That is why `Resizer` takes `min`/`max`
  as props rather than importing the pane-width constants.
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

## Rules that must not be silently reversed

- **No real tag parser exists until M5.** `src/data/repositories/index.ts` wires a
  `noTags` stub returning `[]`. `parseTags` is one of two functions where a wrong
  implementation silently corrupts user data, so the spec makes TDD mandatory for
  it. Do not write a "simple regex one for now".
- **Swapping in that parser is not a one-line change.** Every note written during
  M2–M4 accumulates an empty tag index, so M5 also needs a rebuild-on-upgrade step.
  This is the largest outstanding debt and it grows.
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

## Carried into M5

Real, deliberately deferred with a ruling. Full M3 reasoning is in
`.superpowers/sdd/2026-08-08-m3-notes/progress.md`; full M4 reasoning is in
`.superpowers/sdd/2026-08-09-m4-editor/progress.md`. Fold these into M5's plan
rather than rediscovering them.

- **Deleting a blank note purges it rather than trashing it**, silently. The
  Delete button is irreversible there and identical everywhere else. Defensible
  under the blank-note rule, but M6 owns trash management and should decide.
- **A blank note open across a reload is never discarded**, because
  `beforeunload` only flushes and does not unmount. Spec-compliant as written; a
  startup sweep of empty notes would close it and belongs to a future milestone.
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
- **Tag marks and syntax-visibility toggling are still deferred**, per the M4
  spec. Not a defect; M5 owns tags.

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
