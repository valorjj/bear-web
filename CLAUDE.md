# bear-web

A local-first, web-based notes app modeled on the Bear macOS app. Three panes
(tag sidebar / note list / editor), Markdown notes, organized by inline hashtags
rather than folders. No backend, no account — everything lives in the browser's
IndexedDB.

**Live:** https://valorjj.github.io/bear-web/
**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Plans:** `docs/superpowers/plans/`

## Status

| Milestone                      | State                                             |
| ------------------------------ | ------------------------------------------------- |
| M0 scaffold, CI, Pages deploy  | complete                                          |
| M1 data layer (Dexie)          | complete                                          |
| M2 application shell           | complete                                          |
| M3 notes CRUD, textarea editor | next                                              |
| M4–M9                          | editor, tags, smart lists, search, themes, polish |

113 unit tests, 10 end-to-end tests. `main` is always green and auto-deploys.

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

## Open decision for M3

Selection state — which note is open — has no home. The only pattern in the
codebase is "durable, via `settings` + `useLiveQuery`", and copying it would
persist a note id that may be deleted and round-trip every click through
IndexedDB. Choose `useState` lifted into `AppShell`, or introduce Zustand, which
the spec reserves for exactly this. Decide before implementation, not during.

Also for M3: `AppShell` already does two jobs (layout and width persistence).
Adding selection and a note list without extracting a `usePaneWidths` hook will
make it the file everyone edits.
