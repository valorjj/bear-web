# bear-web

A local-first, web-based Markdown notes app: **lightweight, fast, beautiful,
easy to use, with image storage.** Three panes (tag sidebar / note list /
editor), notes organized by inline hashtags rather than folders. No backend, no
account — everything lives in the browser's IndexedDB.

**Bear is a reference, not a target.** The app was built as a Bear clone and M8
treated Bear's measured geometry as the definition of correct. That ended at
M9a. `npm run measure` and the "Measured against the real Bear" section of
`docs/design/DESIGN-bear-web.md` remain the only tooling that can see "renders
wrong", so keep using them for self-comparison and regression — but **a
measurement that diverges from Bear is no longer a defect on its own**, and
"Bear does it this way" is not by itself an argument. Image storage is a wanted
feature and is not yet scheduled.

**Live:** https://valorjj.github.io/bear-web/
**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Plans:** `docs/superpowers/plans/`

## Status

| Milestone                                                         | State    |
| ----------------------------------------------------------------- | -------- |
| M0 scaffold, CI, Pages deploy                                     | complete |
| M1 data layer (Dexie)                                             | complete |
| M2 application shell                                              | complete |
| M3 notes CRUD, textarea editor                                    | complete |
| M4 editor                                                         | complete |
| M5 tags                                                           | complete |
| M5.5 design language                                              | complete |
| M6 smart lists, trash management                                  | complete |
| M7 search                                                         | complete |
| M7.5 visual design pass                                           | complete |
| M7.6 tag pills                                                    | complete |
| M7.7 tag pill activation                                          | complete |
| M8 visual pass (chrome, density, prose)                           | complete |
| M8b export: Markdown, HTML, PDF                                   | complete |
| M8c tables as real nodes                                          | complete |
| M9a visual system: themes, scale, picker                          | complete |
| A note-list header (scope, sort, preview)                         | complete |
| B collapsible headings + level badge                              | complete |
| E editor affordances (heading icon, highlight colours, table bar) | complete |
| F theme system: derivation, 16 themes, card picker                | complete |
| B2 drag-to-reorder headings                                       | queued   |
| D1 server: hosting, accounts, Google login                        | complete |
| D2 server: the sync protocol                                      | complete |
| C code block language + highlighting                              | complete |
| M9b callout blocks                                                | deferred |

1614 unit tests (plus 84 server tests, 55 of which are integration tests that
skip when `TEST_DATABASE_URL` is unset), 107 end-to-end tests. `main` is
always green and auto-deploys.

**D reverses the "no backend, no account" premise above.** D1 shipped
`server/`: a Hono service on Node against its own MariaDB container on the Mac
Mini, with Google OAuth2 accounts (Authorization Code + PKCE) and an opaque,
revocable session cookie. GitHub and Naver were part of the original idea but
were not built in D1 — only Google exists today. **D2 shipped the sync
protocol: note and tag data now crosses the network**, encrypted in transit,
to the account the signed-in user controls — a per-account revision counter,
`GET`/`POST /sync` with tombstones and a 90-day sweep, and a `(conflict)` note
holding the losing edit of a last-write-wins collision. Local-first is
unchanged: IndexedDB stays the source of truth, sync is automatic and quiet,
and the app works exactly as well offline as it did before D2. See
`docs/rulings/sync.md` for the constraints no test enforces. The UI offers
sign-in, the signed-in identity, sync status, and sign-out and nothing
else — `DELETE /account` exists as an endpoint with no client affordance,
deliberately: it is the spec's day-one requirement, but a wrapper reachable
only from its own tests was removed.
The boot `GET /me` is gated on a locally stored "has signed in before" hint
(`bear-web:account:hasSession`), so a visitor who never signed in makes no
cross-origin request at all — without the gate `e2e/smoke.spec.ts` was red on
`net::ERR_NAME_NOT_RESOLVED` and every offline user got a console error. The
server binds `127.0.0.1` and the database publishes `127.0.0.1:3308`: the
rate limiter trusts `cf-connecting-ip` verbatim, so the tunnel must be the only
path in. D is NOT in the A/B/C queue.
Decisions already taken: local-first is KEPT (IndexedDB stays the source of
truth, the server is a sync target), identity is per-provider with no
email-based auto-linking, and A shipped first. Constraints and the reasoning
are in `docs/superpowers/NEXT.md`; a browser cannot speak the MySQL wire
protocol, so the server is the project. See `server/README.md` for how to run
it — including `server/.env.local` and `npm run server:dev:local` for local
development, since `server/.env` holds the production origins the live tunnel
depends on and the two servers cannot run at once.
**Production runs as a launchd service** (`com.markflowing.api`) as of
2026-08-24, controlled by the `server:service:*` npm scripts. Its `KeepAlive`
is unconditional, so **`lsof -ti:8787 | xargs kill` no longer stops it** —
launchd restarts it within ~10s and your local server then cannot bind. Run
`npm run server:service:stop` before `server:dev:local`.

**The last five rows are not numbered milestones yet**, and the lettering is
`docs/superpowers/NEXT.md`'s, which holds the order and the reasoning for it.
B is the sub-project M9a's spec named **M9c**; do not read the letters as new
milestone ids. **B2 is not part of that spec** — it is a follow-up named only
once B shipped, queued but unscheduled. Its ordering relative to C is an open
question, not a ruling — nobody has decided whether either blocks the other.
**M9b callout blocks is deferred, not dropped** — specced in M9a's
decomposition, deliberately not chosen this round, still unblocked.

**Image storage is named in this project's goal and has never been
scheduled** — not by a milestone and not by the three sub-projects above. It is
larger than all three together and none of them block it. Treat its absence
from this table as an open decision, not as a ruling.

**Two further Playwright entry points exist and are deliberately not in that
count, because they assert nothing.** Both drive the fixed corpus in
`e2e/fixtures/corpus.ts`, and `grepInvert` on `@shots|@measure` in
`playwright.config.ts` keeps both out of `npm run test:e2e`:

- `npm run shots` → `e2e/shots.spec.ts` writes design reference screenshots to
  `docs/design/shots/` (gitignored) — three panes, search, trash, the empty
  state, a folded heading-dense note, the open note-list options menu, a
  three-language code note (one unregistered language, to keep the plain-
  render fallback visible) and the exported document, **in every theme in the
  roster** (13 shots × 16 themes = 208 files, up from 192 when C added its own
  shot). The theme list is derived from `themes.ts` by a regex requiring `id`, `labelKey` and
  `group` on ONE line in that order — a Prettier reflow would make it match
  nothing, and an empty list renders the default theme sixteen times with no
  error. Count the files, do not trust the exit code.
  Themes are selected through the paint-time mirror, the way a user selects
  one. Until M9a it drove `colorScheme` instead, i.e. the media query, and the
  shot labelled `paper` silently started rendering Indigo Light the moment the
  default theme changed.
- `npm run measure` → `e2e/measure.spec.ts` writes the app's real geometry and
  typography for 27 surfaces to `docs/design/measurements.md` and `.json`.

They exist because **nothing in the test suite can see "renders wrong"**: the unit
suite has no layout engine and `e2e/appearance.spec.ts` is deliberately relative.
A visual change is therefore checked against a measured number and a screenshot,
not by eye. `docs/design/measurements.md` is one half of the comparison against
Bear recorded in `docs/design/DESIGN-bear-web.md`.

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

All six must pass before any commit. `npm run shots` and `npm run measure` are
not part of the gate — see above.

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
- **`renderIconMarkup` takes a LIST of shapes, not one path, and `Icon.tsx`
  carries lucide's `__iconNode` arrays verbatim.** It draws the ProseMirror
  widgets that cannot render React (`HeadingFold`'s gutter). Importing
  `lucide-react` there instead was measured at **+187.89 kB raw / +57.20 kB
  gzip** and rejected. The single-`d` form it started with could not represent
  `Heading6` at all — that glyph draws its numeral with a `<circle>` — and the
  test guarding the copies walked only `<path>` elements, so it would have
  declared a glyph MISSING that shape identical to one that had it. Both are
  generalised now; a new glyph is a verbatim entry in `ICON_NODES` plus a row
  in `Icon.test.tsx`'s `it.each`.

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
- **`playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`, and
  the failure is silent in BOTH directions.** Two parallel `npm run test:e2e`
  runs — two subagents, or a human and an agent — share that port, so the second
  measures the first's tree. Worse and more common: **any preview server left on
  4173 is reused, so the suite silently tests a stale build.** M9a hit this
  twice. A fault injection meant to prove a test could fail PASSED, because the
  build never re-ran; and a genuine failure looked like a regression when it was
  a typecheck error that had stopped `npm run build` (the webServer command is
  `npm run build && npm run preview`, so a type error anywhere — including in
  `e2e/`, which `tsc -b` also compiles — reports only `Exit code: 2`).
  **Before trusting any e2e result that follows a source change, and always
  before a fault injection:** `lsof -ti:4173 | xargs -r kill -9`.

- **A derived token computes to `color(srgb …)`, and `parseColour` was
  silently blind to it.** Its fallback stripped an `rgb(` prefix that is not
  there and produced `NaN` — and `e2e/contrast.spec.ts` collects a failure on
  `ratio < min`, which is FALSE for `NaN`. An unreadable theme would have
  passed rather than thrown. Any future colour function (`lab()`, `oklch()`)
  reaching a computed value needs the same treatment, and the failure mode is
  silence, not a crash.

- **Reading a custom property back does NOT resolve it.** Custom property
  values are substituted lazily, so `getPropertyValue('--bear-muted')` on a
  derived theme returns the literal string
  `color-mix(in oklab, #e8e8f5 68%, #202030)`, not a colour. A spike that read
  a PAINTED property (`getComputedStyle(el).backgroundColor`) saw a resolved
  `color(srgb …)` and hid this completely. `e2e/fixtures/tokens.ts` paints
  each token onto a probe element for exactly this reason; every consumer must
  go through it, or one side holds a keyword and the other a resolved colour
  and they will not compare equal.

- **Several e2e tests fail under machine load, and the failures look like
  regressions.** With `load average` well above the core count, different
  timing-sensitive tests fail on each run — `smoke.spec.ts`'s pane-resize
  persistence, `appearance.spec.ts`'s pane elevation — none of them related to
  whatever was just changed. Two genuine races were found and fixed this way
  (the elevation test read computed styles before React had mounted; a mark
  command ran against a selection that had not landed yet), so the failures
  are worth reading rather than dismissing — but **check `uptime` before
  concluding a diff broke the suite**, and re-run once the machine is quiet.
  Back-to-back full runs are themselves the usual cause.

- **A backtick inside a CSS comment in `src/features/export/html.ts`
  terminates the template literal holding the export stylesheet.** The whole
  stylesheet is one template literal, so a comment written in this project's
  usual `` `code` `` style produces a parse error whose message points at the
  prose, not at the backtick — and because that module is imported widely, ten
  unrelated test FILES fail to load at once. The real cause is one character.

- **Class-attribute order does not decide the CSS cascade; stylesheet order
  does.** `Pane` had `shadow-popover` in its base classes, and appending
  `shadow-none` via `className` did nothing at all — both are utilities in the
  same layer, so the one Tailwind happens to emit later wins regardless of
  which the element lists last. There is no warning. Express "not this
  utility" as a prop that omits the class (`Pane`'s `elevated`), never as an
  overriding utility.

- **`document.documentElement` is null at `document_start`.** A Playwright
  `addInitScript` that touches it throws before recording anything, and an
  empty result array looks exactly like "the thing never happened". This cost a
  wrong diagnosis of the no-flash test. Observe `document` for `<body>`
  appearing instead.

- **Vitest runs two projects now, and the server project deliberately does not
  `extend` the root config.** `vitest.setup.ts` installs jsdom and swaps the
  global `Blob` for Node's; inheriting that in server tests would make them
  lie about the environment they prove. `server/src/app.test.ts` asserts
  `globalThis` has no `document` property. **What that assertion actually
  catches is narrower than it sounds**: the `app` project is the one that
  `extends` the root config and sets `environment: 'jsdom'` and `setupFiles`;
  the `server` project sets its own `environment: 'node'` explicitly and
  extends nothing, and the root `test` block itself carries no `environment`
  or `setupFiles` at all. There is therefore nothing left for the server
  project to accidentally inherit — the guard can only catch someone
  explicitly setting the server project's `environment` to `'jsdom'` (or
  flipping its `extends` to `true`), not a silent collapse of the split. A
  server test file misplaced under `src/` still runs in jsdom without
  complaint, because Vitest's `include` glob decides which project a file
  belongs to, and that glob is not what this test checks.
- **The database integration tests skip when `TEST_DATABASE_URL` is unset**,
  which locally is convenient and in CI would be a green suite that ran
  nothing. `server/src/db/migrate.test.ts` asserts the variable is present
  whenever `CI` is set, so removing it from `ci.yml` fails loudly instead.
- **The integration tests truncate whatever database `TEST_DATABASE_URL`
  names, on every run.** Dev is `markflowing`; tests are
  `markflowing_test`. Before the split, running `npm test` locally ran the
  suite's `DELETE FROM users` against the same database a developer was
  signed into, deleting a real account with no warning.
  `server/src/db/testDatabaseIsolation.test.ts` now fails if `DATABASE_URL`
  and `TEST_DATABASE_URL` ever name the same database — never widen
  `TEST_DATABASE_URL` to point at a real environment's database to work
  around a connection issue.
- **A `Domain=` attribute on the session cookie is a cross-project leak, not a
  convenience.** `lunch-api.markflowing.com` and `docs-api.markflowing.com`
  are unrelated projects on the same registrable domain, so the cookie is
  host-only on `api.markflowing.com`. Nothing in the test suite can see a
  wrongly-scoped cookie in a real browser — check DevTools.
- **`SameSite=Strict` silently breaks OAuth.** Strict is dropped on the
  redirect back from Google, so the user lands on the app still signed out with
  no error anywhere. Both cookies are `Lax` for this reason.
- **Both cookies use the `__Host-` name prefix when served over HTTPS.** This
  is not cosmetic: `HttpOnly` does not protect against an attacker who _is_
  the client, and host-only scoping stops egress to sibling subdomains but NOT
  ingress from them — a compromised `lunch-api.markflowing.com` could
  otherwise set a `Domain=.markflowing.com` cookie this API would read,
  enabling login CSRF and session shadowing. `__Host-` is browser-enforced.
  Consequence: the cookie NAME differs between `http://localhost` and
  production, and `API_ORIGIN` must match the scheme the browser actually
  uses to reach the API — a mismatch makes the browser silently reject the
  cookie and login simply stops working, with no error anywhere.
- **The OAuth transaction is deliberately stateless and therefore replayable
  within its 600s lifetime.** Single-use enforcement comes from the provider
  rejecting authorization-code reuse. Closing it properly would need a
  consumed-transaction store, which contradicts the design decision that the
  service holds nothing between legs.
- **The rate limiter trusts `cf-connecting-ip` and `x-forwarded-for`
  verbatim, and holds windows in an unbounded in-memory `Map`.** Both are safe
  only while Cloudflare is the guaranteed front door and the process is not
  reachable directly. Bind the server to localhost so the tunnel is the only
  path in; the `Map` is never pruned.
- **`useSession` must survive React StrictMode's phantom double-mount.** A
  cleanup-only effect that permanently falsified its mounted ref left `npm run
dev` stuck on "loading" forever while the production build and all six gates
  passed — so no test caught it. It was found by running the app. No gate can
  see this class of bug; running the app can.
- **A plan's component-usage sketch is not a signature reference.** Task 10's
  plan guessed `Icon`'s prop as `of` (it is `glyph`), invented a
  `TestI18nProvider` that does not exist (the real helper is
  `I18nProvider`), and named `lucide-react` icons that do not exist in the
  package. Every one of those guesses was wrong. Check the real signature
  before writing code from a plan written from memory, not after.

- **A launchd job cannot read `~/Documents`, and it HANGS rather than
  failing.** This is why the repo lives at `~/WebstormProjects/bear-web` and
  must not move back under `~/Documents`, `~/Desktop` or `~/Downloads`. The
  API service was first built with the repo under `~/Documents`: the process
  stayed alive forever with an empty log and nothing bound to 8787, blocked in
  `node::Dotenv::ParsePath → uv_fs_open → open()`. It is not about `.env` or
  `--env-file` — a three-line test agent read `/private/tmp` fine and then hung
  on `package.json`. Those are TCC-protected locations and a headless agent
  cannot answer the consent prompt, so `open()` never returns. **Nothing is
  logged** — no TCC denial, no error — and because the process never exits,
  `KeepAlive` sees a healthy job, so the supervisor is blind too. Diagnosed
  with `sample <pid>`, which is the only tool that showed anything; a crash
  loop would have been louder than this silence.

- **`which node` here is a per-shell path that does not survive a reboot.**
  fnm resolves it to
  `~/.local/state/fnm_multishells/<pid>_<timestamp>/bin/node`. Any launchd
  plist, cron entry or systemd-alike pointing there fails `ENOENT` after the
  shell that made it exits. Use `~/.local/share/fnm/aliases/default/bin/node`,
  the stable symlink `fnm default <version>` retargets.

- **An unmapped `.hljs-*` class renders as plain, uncoloured text with no
  error anywhere.** `highlightClasses.ts`'s `ROLE_CLASSES` (and
  `KNOWN_FLATTENED_COLLISIONS` for a class carrying two roles at once) is the
  only thing standing between a highlight.js scope and a colour; a class not
  listed there simply matches no CSS rule and the text renders in the
  surrounding text colour. Nothing crashes, nothing logs, and the unit suite
  passes — this is exactly the shape of failure `scripts/contrast.ts`'s
  `parseColour` had for `oklab()`, and it is why the enumeration test in
  `highlightClasses.test.ts` fails BY NAME on a corpus-produced combination
  with no matching rule, rather than the guard silently passing.

- **The editor FLATTENS a code block's highlight classes onto one span per
  leaf; export NESTS them as real elements — so equal-specificity CSS rules
  resolve differently between the two paths for the same source.**
  `@tiptap/extension-code-block-lowlight`'s decoration plugin concatenates
  every ancestor scope's class onto a leaf's single `<span>`
  (`class="hljs-title class_"`); `src/features/export/html.ts`'s
  `highlightCodeBlocks` re-highlights from the same lowlight instance but
  produces genuine nested parent/child elements the way hast output normally
  does. On the flattened span, two single-class rules of equal specificity
  are decided by which role's CSS block sits later in the stylesheet; on the
  nested markup, the innermost element simply wins by DOM structure.
  `KNOWN_FLATTENED_COLLISIONS` plus its mirrored compound selectors in both
  `editor.css` and the export stylesheet exist so the two paths agree despite
  this — see `docs/rulings/markdown-and-schema.md`.

- **`CodeBlockLowlight` applies its `.hljs-*` classes as ProseMirror
  DECORATIONS, which live in the `EditorView` and are never part of the
  document `DOMSerializer` walks.** Exporting a note by serializing the
  document therefore produces `<pre><code>` with the raw text and ZERO
  highlight classes — a stylesheet with every `.hljs-*` rule correctly
  defined, applied to nothing. `src/features/export/html.ts` cannot inherit
  highlighting "for free" the way it inherits everything else about the
  rendered document; it re-highlights every `pre > code` itself
  (`highlightCodeBlocks`) using the same lowlight instance the editor uses
  (declining, not guessing — see the lowlight-registries ruling), specifically
  because decorations are a view-layer concept with no serialized form.

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
- `server/` is a fifth tsconfig project and may import **only**
  `src/data/types.ts` from under `src/` — never `src/features/`, `src/ui/`,
  `src/app/` or `src/i18n/`. Enforced by `scripts/serverBoundaries.test.ts`,
  which also holds the **multi-tenancy guard**: every SQL statement naming a
  user-scoped table must constrain `user_id` or carry an explicit
  `/* tenancy-ok: reason */`. One forgotten `WHERE` is a cross-user notes leak,
  which is not a class of bug to catch by review. The guard requires `user_id`
  in a **predicate** position (`user_id =` / `user_id IN`), not merely
  mentioned on the line — its original bare-substring form accepted `SELECT
user_id FROM identities WHERE email = ?`, which reads `user_id` without
  constraining by it, exactly the leak shape the guard exists to reject. An
  `INSERT INTO` naming `user_id` in its column list is accepted, because the
  value is supplied rather than filtered. The `/* tenancy-ok: reason */`
  annotation is matched on the statement's own line or exactly one line
  above — a Prettier reflow that moves it further away turns a legitimate
  statement red, a known nuisance that fails loud rather than silent.

## Rules that must not be silently reversed

**The rulings live in `docs/rulings/`, not here.** 160 bullets across 12 files,
every one a live constraint. They are NOT loaded into context automatically —
this index is. Its job is to tell you which file to open before you touch
something, so read the row before you write the diff, not after.

The triggers below are deliberately written as **things visible in a diff** —
file paths and symbol names — rather than as topics. If your change touches a
row's trigger, open that file first. Each file repeats its own trigger in full
at the top; the rows here are abridged.

| Before you touch…                                                                                                                                                                                                                                                                                        | Read first                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/tags/` — `parseTags`, `findTagRanges`, `normalizeTag`, `MASK`, the fence and mask helpers; `TAG_INDEX_VERSION`; any prose introducing the mask character's escape sequence                                                                                                                     | [tag-grammar.md](docs/rulings/tag-grammar.md)                                                                                          |
| `src/data/migrations.ts`, `sweep.ts`, `persist.ts`, `backup.ts`, `db.ts`'s `stores({…})`; the `noteTags` writes in `repositories/notes.ts`; the boot sequence in `main.tsx`; a new `db.version(n).upgrade()`                                                                                             | [tag-index-and-startup.md](docs/rulings/tag-index-and-startup.md)                                                                      |
| `NoteEditor.tsx`, `useAutosave.ts`, `useNotes.ts`, `derive.ts`, `useFlushTriggers.ts`; `AppShell`'s `key={…}` / `seed`; any `useLiveQuery` whose deps are not `[]`; `notes.purge` / `notes.save` call sites                                                                                              | [notes-lifecycle.md](docs/rulings/notes-lifecycle.md)                                                                                  |
| `scope.ts` (`NoteScope`, `SMART_LIST_IDS`, `scopeKey`, `ScopeQuery`, the capability functions), `src/data/order.ts`, `ScopeMenu.tsx`, `useSetting.ts`, `smartLists.ts`, `useSmartListCounts.ts`, `search.ts`, `HighlightedText.tsx`, `ConfirmDialog.tsx`, `AppShell`'s scope/query state                 | [scopes-and-search.md](docs/rulings/scopes-and-search.md)                                                                              |
| `src/features/editor/markdown.ts`, `extensions.ts`, `RawBlock.ts`, `toolbarSelection.ts`, `taskItemPromotion.ts`; the `CANONICAL` / `NON_CANONICAL` fixtures; a new import of `@tiptap/markdown`; a new extension, input rule, **or keyboard binding** (`useScopeShortcuts.ts` included)                 | [markdown-and-schema.md](docs/rulings/markdown-and-schema.md)                                                                          |
| `tableMarkdown.ts` (`MarkdownTable`, `withPipeEscapingCells`), the `@tiptap/extension-table` entries in `extensions.ts`, `RawTable`, `table.test.ts`, any table fixture                                                                                                                                  | [tables.md](docs/rulings/tables.md)                                                                                                    |
| `TagPill.ts` (`tagDecorations`, `tagRangeAt`, the `mousedown` handler), `blockText.ts` (`maskedBlockText`), `RichEditor`'s `activateRef` / `data-mod-held`, `AppShell.handleActivateTag`, `--bear-tag-fill*`, `tagAgreement.test.ts`                                                                     | [tag-pills.md](docs/rulings/tag-pills.md)                                                                                              |
| `src/features/export/` — `html.ts`, `exportNote.ts`, `print.ts`, `filename.ts`, `ExportMenu.tsx`; `NoteEditor.handleExport`; the `export.*` i18n keys and `ALLOWED_IDENTICAL`                                                                                                                            | [export.md](docs/rulings/export.md)                                                                                                    |
| `src/styles/*.css`, `themes.ts`, `app/theme.ts`, `index.html`'s inline script, `Pane.tsx`, `Resizer.tsx`, `Button.tsx`, `ThemePicker.tsx`, `RichEditor.tsx`; a new `--bear-*` property, `[data-theme]` block, spacing / radius / shadow / `outline-none` utility                                         | [design-tokens-and-layout.md](docs/rulings/design-tokens-and-layout.md)                                                                |
| `src/data/sync/` (`config.ts`, `transport.ts`, `engine.ts`, `markDirty.ts`), `syncState` in `db.ts`, `server/src/repositories/sync.ts`, `server/src/routes/sync.ts`, `server/migrations/002_sync.sql`, `LAST_PULLED_REV_KEY`, `SYNCED_ACCOUNT_KEY`, `useSync.ts`, `markAllDirty`, `reindexNote`          | [sync.md](docs/rulings/sync.md)                                                                                                        |
| `Highlight.ts` (`HIGHLIGHT_COLORS`, `highlightClass`, the `color` attribute, the tokenizer's two branches), `HighlightMenu.tsx`, `--bear-hl-*`, `BottomToolbar`'s colour chevron                                                                                                                         | [markdown-and-schema.md](docs/rulings/markdown-and-schema.md), [design-tokens-and-layout.md](docs/rulings/design-tokens-and-layout.md) |
| `TableControls.ts` (`TABLE_ACTIONS`, `tablePosAt`, `COMMANDS`, `labels`), `tableControls.test.ts`, `.bear-table-controls` in `editor.css`                                                                                                                                                                | [tables.md](docs/rulings/tables.md), [accessibility.md](docs/rulings/accessibility.md)                                                 |
| any `aria-*` attribute or accessible-name assertion; `Icon.tsx`, `SidebarRow.tsx`'s explicit space, `NoteListItem.tsx`'s label, `preview.ts`'s `snippetLines`, `Button.tsx`'s variants and its `ariaHasPopup`/`ariaExpanded`, `NoteList.tsx`'s header, `ScopeMenu.tsx`'s roles, `ConfirmDialog`'s Cancel | [accessibility.md](docs/rulings/accessibility.md)                                                                                      |
| `e2e/appearance.spec.ts`, `smoke.spec.ts`, `contrast.spec.ts`, `scripts/*.test.ts`, the tsconfig `include`/`types`; a `lucide-react` import outside `Icon.tsx`; a `[role="…"]` selector or `.closest()` inside `page.evaluate`; **any test you are about to edit because a restyle made it fail**        | [testing-and-tooling.md](docs/rulings/testing-and-tooling.md)                                                                          |
| planning a milestone, or touching pane widths, `NoteEditor`'s seed/discard, `AppShell`'s confirm handlers, the tag tree, the note-list header, the editor typography tokens, or the Playwright pointer-drag tests                                                                                        | [deferred.md](docs/rulings/deferred.md) — deliberately deferred items, with rulings                                                    |

**Provenance.** The whole set was re-audited on 2026-08-20, one agent per file,
each verifying its bullets against the code. Result: **0 deleted, 3 merged, 1
struck as resolved**, and roughly 45 sharpened with evidence. Four bullets were
found factually wrong and corrected in place rather than removed — the
`danger`/`focus`/`accent` "identical in both themes" claim (dead since M9a's
roster), the resizer gap arithmetic (24px, not 16px), `Button`'s `default`
variant in the note-list header (now `ghost`), and "no test enforces the keyed
remount" (a falsification suite exists; what stays unfalsifiable is the app's
use of the key). Roughly a third of the set is enforced by no test at all —
contrast ratios, "these tokens must stay independent", ordering guarantees —
which is exactly why they are written down.

**Adding a ruling** means adding it to the right file in `docs/rulings/`, not
here. Add a row to this table only when a genuinely new AREA appears, and
extend that file's own `**Trigger:**` line so the two stay in step.

## Working style

Each milestone runs: brainstorm → spec → written plan → subagent-driven execution
with a review after every task and a whole-branch review at the end. Plans live in
`docs/superpowers/plans/`; per-milestone execution ledgers live in
`.superpowers/sdd/<plan-name>/progress.md` (gitignored, local only) and record every
finding, ruling, and deferred item.

**M8 deliberately did not follow that shape**, and the deviation is recorded
rather than hidden: it ran as direct execution against a measurement-driven
roadmap, with no spec, no written plan and no subagents. What replaced the plan
was `npm run measure` and `npm run shots` — each change was justified by a number
measured off Bear and verified by a screenshot afterwards. Its ledger is at
`.superpowers/sdd/2026-08-18-m8-visual-and-export/progress.md` and carries the
roadmap, the rulings the user made, and every open item. A milestone with a
larger design space should go back to brainstorm → spec → plan.

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
