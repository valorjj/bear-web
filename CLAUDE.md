# bear-web

A local-first, web-based notes app modeled on the Bear macOS app. Three panes
(tag sidebar / note list / editor), Markdown notes, organized by inline hashtags
rather than folders. No backend, no account — everything lives in the browser's
IndexedDB.

**Live:** https://valorjj.github.io/bear-web/
**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Plans:** `docs/superpowers/plans/`

## Status

| Milestone                      | State                                     |
| ------------------------------ | ----------------------------------------- |
| M0 scaffold, CI, Pages deploy  | complete                                  |
| M1 data layer (Dexie)          | complete                                  |
| M2 application shell           | complete                                  |
| M3 notes CRUD, textarea editor | complete                                  |
| M4 editor                      | next                                      |
| M5–M9                          | tags, smart lists, search, themes, polish |

178 unit tests, 14 end-to-end tests. `main` is always green and auto-deploys.

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
- `erasableSyntaxOnly` forbids `enum`, parameter properties, and namespaces.
  `verbatimModuleSyntax` requires `import type` / `export type`.

## Architecture boundaries

- `src/ui/` holds presentation primitives. It must import **nothing** from
  `src/app/`, `src/data/`, or `src/i18n/`. That is why `Resizer` takes `min`/`max`
  as props rather than importing the pane-width constants.
- Components reach persistence **only** through `src/data/index.ts`, never a
  repository module directly.
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

## Carried into M4

Real, deliberately deferred at the end of M3 with a ruling. Full reasoning is in
`.superpowers/sdd/2026-08-08-m3-notes/progress.md`. Fold these into M4's plan
rather than rediscovering them.

- **`useAutosave`'s rollback target is optimistic, not confirmed-persisted.**
  `const previous = savedRef.current` may name text that was never actually
  written. With three saves in flight where a superseded one also fails, the
  rollback can target that text; if the user's buffer later coincidentally
  re-equals it, the next flush skips it as unchanged. Reaching it needs a
  three-way overlap inside a 300ms debounce plus an exact string match, which is
  why it was deferred. The honest fix tracks confirmed-persisted text separately
  from the in-flight marker — a redesign, and M4 rewrites this component's caller
  anyway.
- **`usePaneWidths` writes `void settings.set(...)` with no flush**, so dragging
  a separator and reloading immediately can lose the width. Deferred because it
  costs a pane width rather than note content, and because `useAutosave` now has
  the general `beforeunload`/`visibilitychange` flush pair that should be
  extracted and shared rather than duplicated one-off.
- **`format.test.ts` has no midnight case**, so the documented reason for
  choosing `hourCycle: 'h23'` over `hour12: false` — that the latter renders
  midnight as 24:00 under some ICU builds — is asserted in a comment and verified
  by nothing. One extra test case.
- **Deleting a blank note purges it rather than trashing it**, silently. The
  Delete button is irreversible there and identical everywhere else. Defensible
  under the blank-note rule, but M6 owns trash management and should decide.
- **A blank note open across a reload is never discarded**, because
  `beforeunload` only flushes and does not unmount. Spec-compliant as written; a
  startup sweep of empty notes would close it and belongs to a future milestone.

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
