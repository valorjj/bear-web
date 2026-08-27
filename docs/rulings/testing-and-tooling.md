# Testing and tooling conventions

Governs where tests live, which suite is allowed to see "renders wrong", and the
selector and assertion traps that have already let defects through a green suite.

**Trigger:** any edit to `e2e/appearance.spec.ts`, `e2e/smoke.spec.ts`,
`e2e/contrast.spec.ts`, `e2e/account.spec.ts`, `scripts/sourceLint.test.ts`,
`scripts/fonts.test.ts`, `scripts/contrast.test.ts`, `tsconfig.app.json` /
`tsconfig.node.json` `include`/`types`; any new test file under `scripts/`; a
new `import ... from 'lucide-react'` outside `src/ui/Icon.tsx`; any
`page.evaluate` containing `querySelectorAll`, `.closest(`, or a
`[role="..."]` selector; any assertion comparing a computed `backgroundColor`;
any Playwright keyboard shortcut aimed at a Tiptap/ProseMirror binding; any
`addInitScript` writing `localStorage` to seed app state; a push to `main`
after any local merge; and any test whose expectation you are about to edit
because a restyle made it fail.

- **A Playwright `name` is a case-insensitive SUBSTRING by default, and the
  failure reads as "element not found".** `getByRole('button', { name: 'Pin' })`
  matched the sidebar's **Pinned** smart list rather than the note row's pin,
  and because the sidebar is a closed drawer on a phone but a visible pane on a
  desktop, the same locator resolved to different elements in the two blocks of
  `e2e/touch.spec.ts` — passing on touch and failing on a pointer, which reads
  exactly like a broken media query. Pass `exact: true` whenever the accessible
  name is a prefix of another control's.

- **`.click()` drives the MOUSE, and a tap is no better, so neither can prove a
  `(hover: none)` rule.** `e2e/touch.spec.ts`'s table-handle test passed
  against a build with the resting rule inverted **twice**: `.click()` leaves
  the table hovered so `:has(+ table:hover)` matches, and
  `page.touchscreen.tap()` fails the same way because Chromium applies STICKY
  `:hover` to a tapped element on a touch device and holds it until something
  else is tapped. Place the caret with the KEYBOARD when asserting that
  something is visible without hover.

- **A long press cannot be driven by `locator.dispatchEvent`, and CDP is the
  honest route.** `page.touchscreen` offers `tap` and nothing else. A
  synthesised `pointerdown` proves the handler runs but not that the gesture
  reaches it — the same mistake as `{ force: true }` in `e2e/pdfExport.spec.ts`,
  an event no user can produce. `Input.dispatchTouchEvent` over a
  `context.newCDPSession(page)` makes Chromium generate genuine `pointer`
  events carrying `pointerType: 'touch'`, and it is what caught the
  synthetic-mouse dismissal bug that no unit test could see.

- **A note's FIRST block is its title and is never foldable**, so a fixture
  opening on `## Heading` carries no fold toggle and every assertion about the
  gutter fails as "element not found" rather than as a missing rule. Seed a
  plain title line first. `e2e/appearance.spec.ts`'s fold-gutter fixture says
  the same thing at its own call site; `e2e/touch.spec.ts` learned it again.

- **`expect.poll` can hide a missing listener completely.** J3's handle-drift
  test scrolled a table and polled the handle's alignment; ANY unrelated
  ProseMirror view update inside the five-second window re-measures the layer,
  so the test passed with the scroll listener deleted. What a user sees during a
  fling is the frame right after the scroll, so that is what the test must read:
  scroll and measure in ONE `page.evaluate` round trip, two `requestAnimationFrame`s
  later. It then fails at exactly the 120px it was scrolled by. Poll for a state
  you are WAITING for; never for one you are asserting did not drift.

- **Sabotaging several mechanisms at once can make a test vacuous rather than
  red.** Removing the table's width floor and the handle scroll listener in the
  same run left the table too narrow to scroll, so `scrollLeft = 120` did
  nothing and the handle test passed. Falsify one mechanism at a time, or the
  injection proves the opposite of what it looks like.

- **Playwright cannot open a virtual keyboard, and resizing the viewport is not
  a substitute.** On iOS a keyboard shrinks `visualViewport.height` WITHOUT
  changing `window.innerHeight`; a viewport resize moves both, which is the one
  case `src/lib/visibleViewport.ts` does not need help with.
  `e2e/fixtures/fakeViewport.ts` replaces `visualViewport` through
  `Object.defineProperty` in an init script — a plain assignment silently does
  nothing, because it is a readonly accessor on the prototype. It must run
  before boot, because the hook seeds during the app's first render.

- **Nothing in the repo can prove the browser honoured
  `interactive-widget=resizes-content`.** `e2e/phoneEditor.spec.ts` stays green
  with the token misspelled — it drives the JS fallback.
  `scripts/sourceLint.test.ts` asserts the token is present, which catches
  deletion and a typo and nothing else. The spec's real-device checklist is the
  only thing that covers the browser path, and item 1 on ANDROID is the only
  thing that can show the two mechanisms do not double-apply.

- **`npm run measure` drifts, and the fix is `npm run measure:check` LOCALLY —
  never in CI.** `docs/design/measurements.md` sat three days and three
  sub-projects stale (J2a's 16px search field, I's row height, M9b's extra
  toolbar control). The check ran in `ci.yml` for exactly one commit and failed:
  **text-derived widths differ between ubuntu and macOS.** The scope header
  button measured 68.7 on macOS against 70 on ubuntu; the tag pill 573.6
  against 564.2 — a 9.4px gap, LARGER than a real change worth catching (I
  moved a row height by 4px), so no tolerance separates signal from noise.
  Every height and every style value matched; widths alone diverge, and only
  where the box is sized by its text. The comparison is therefore meaningful
  only on the machine that generated the file.
  `scripts/ciCoverage.test.ts` asserts the step is ABSENT from `ci.yml` so
  re-adding it fails with the reason attached. And when a diff does appear, run
  `measure` on `main` before attributing it: J3's output was byte-identical to
  `main`'s, so none of that drift was J3's.

- **A source-scanning assertion cannot tell a command from a COMMENT about the
  command.** `scripts/ciCoverage.test.ts` asserted `ci.yml` contains
  `'npm run measure'`; deleting the step left the test green, because the
  paragraph explaining why the step exists says those words too. It now reads a
  comment-stripped view (`commands`), and every "CI actually runs this"
  assertion in that file must use it. The same trap applies to any test that
  greps prose-bearing source for a symbol it expects to be CALLED.

- **Source-scanning tests live in `scripts/`, not `src/`.** `tsconfig.app.json`
  deliberately omits Node types (`"types": ["vite/client", "vitest/globals"]`,
  `"include": ["src"]`); `tsconfig.node.json` already includes `scripts`.

- **A role-based test that fails during a restyle is reporting a behaviour
  change, not a stale expectation.** Editing it to match the new output is the
  same defect as asserting a class name. This is how the `SidebarRow` space
  regression nearly shipped — see the accessible-name bullets in
  `docs/rulings/accessibility.md`; `src/ui/SidebarRow.tsx` still carries the
  explicit `{' '}` text node that regression removed.

- **`e2e/appearance.spec.ts` is the suite that can see "renders wrong", and it
  is deliberately RELATIVE where `smoke.spec.ts` is absolute.** Three defects
  shipped through a fully green 700+ test suite — the missing `--color-hover`,
  `Button`'s borderless-and-fill-less `default` variant, and the total absence
  of editor prose CSS — because the round-trip suite drives `MarkdownManager`
  with no DOM and the component tests assert document structure, never computed
  style. **It is no longer the only such test**: M9a added `e2e/contrast.spec.ts`,
  which runs the real Chromium cascade over every theme in the roster, and
  `npm run measure` / `npm run shots` cover geometry and screenshots. It now
  holds **23 tests, not the five the original ruling counted** — the file grew
  through M8 and M9a — and the rule about them is unchanged: each was verified
  by reintroducing the exact defect it guards and watching precisely the
  intended test fail; **any new one belongs there only if it fails under a
  fault injection.** Assertions are relationships (a heading is larger than a
  paragraph, a checkbox's box overlaps its label's vertically) rather than
  pixel values, because M8's typography sliders move every absolute size by
  design — pinning them would turn M8 into a test-editing exercise, which is
  the failure mode M5.5 already hit once. `smoke.spec.ts` pins absolutes for
  the opposite and equally deliberate reason: a palette change _should_ cost
  a conscious edit.

- **`e2e/smoke.spec.ts` pins the shipped palette deliberately.** It is the only
  test proving the `prefers-color-scheme` cascade reaches a rendered pixel
  (`emulateMedia({ colorScheme })` plus literal `rgb(230, 225, 245)` /
  `rgb(20, 18, 27)` expectations), so a token change SHOULD require a conscious
  edit there. It went stale for four tasks during M5.5 because e2e was not run
  on every restyle task; M9a's default-theme change is the licensed edit,
  recorded in the file's own comments.

- **`lucide-react` is imported only by `src/ui/Icon.tsx`, and that is enforced
  by `scripts/sourceLint.test.ts`** ("imports lucide-react only through
  src/ui/Icon.tsx"). The primitive fixes one stroke width, two sizes, and
  `aria-hidden` on every icon in the app; glyphs are re-exported from that file
  so feature code never reaches the package. A second importer would compile
  and look fine, which is why this is a test rather than a comment — unlike the
  `@tiptap/markdown` single-importer rule, which is convention enforced by
  nothing.

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
  tests — the button-at-rest test (since reshaped into "a quiet header control
  still has a hover affordance and a name") and "the search field reads as a
  control at rest" — that used `.closest()`, got `null` back for the pane every
  time, and so compared a colour string to `null` instead of to the pane's
  actual background; that comparison is always true, so neither had ever caught
  a fill identical to its pane. Every site now selects on the attribute
  actually present, `section[aria-label]`; the `.closest()` sites also assert
  the pane was found at all (`expect(pane, 'no pane found — a null here would
  make the check below vacuous').not.toBeNull()`), so a null lookup fails
  loudly instead of quietly validating anything compared against it.
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
  not-transparent, and not-equal-to-canvas. The same pair is now repeated for
  the tag pill, the floating toolbar fills and the theme swatches, each with
  its own comment pointing back at the card test.

- **`Mod-` is platform-resolved; a hardcoded `Meta` press is a macOS-only
  test.** Tiptap binds headings to `` `Mod-Alt-${level}` `` in
  `@tiptap/extension-heading`, and ProseMirror resolves `Mod-` to **Cmd on
  macOS, Ctrl everywhere else**. `e2e/noteListHeader.spec.ts` pressed
  `Alt+Meta+Digit4`, which makes an `h4` on a developer's Mac and **silently
  makes nothing on `ubuntu-latest`**, where Meta is Super — the assertion
  failed with "0 elements" and no hint as to why. The app's OWN shortcuts
  (`src/app/useScopeShortcuts.ts`) check `event.metaKey || event.ctrlKey`
  directly, so they already work on both platforms; that asymmetry is why
  this was the only spec to fail, and why it read as an unrelated
  regression. Every other spec already pressed Playwright's `ControlOrMeta`
  (`ControlOrMeta+Alt+f` for the fold toggle is the identical shape) — this
  one was the lone holdout, fixed in `f7eafde`. **Reusable rule: any
  keystroke aimed at a Tiptap/ProseMirror binding must be pressed as
  `ControlOrMeta`, because the binding itself is platform-resolved; a press
  aimed at the app's own handlers may use either, since those accept both.**

- **Local CI green is not CI green, when the remote is behind.** `origin/main`
  was once 40 commits behind local `main` — three sub-projects had been
  merged locally and never pushed, so GitHub Actions had never run their
  tests at all. The next push ran CI on all three at once, and the failure it
  surfaced belonged to the OLDEST of them, not the change being pushed. A red
  CI run immediately after a merge is therefore not evidence the merge caused
  it: check `git rev-list --count origin/main..main` and what CI last
  actually ran before attributing a failure. This is also why the `Mod-`
  bullet above survived undetected as long as it did — the suite passed on
  every local (macOS) run, and nothing had pushed to make CI (Linux) say
  otherwise.

- **Pane widths live in IndexedDB, not `localStorage` — a `localStorage` seed
  silently no-ops.** Pane widths are a `settings` row read by `useSetting`. A
  Playwright `addInitScript` writing
  `window.localStorage.setItem('bear-web:pane.sidebarWidth', …)` looks exactly
  right, throws nothing, and does nothing. A first draft of the account-menu
  clipping test (`e2e/account.spec.ts`) did this, so it measured a
  default-width sidebar while its own comment claimed 160px — the assertion
  still passed, for the wrong reason. Seed through `e2e/fixtures/seed.ts`'s
  `seedDatabase(page, { settings: [...] })` instead, as
  `e2e/account.spec.ts` and `e2e/smoke.spec.ts` do. Same family as the
  `[role="..."]`/`.closest()` bullets above: a setup that throws nothing and
  covers nothing.
