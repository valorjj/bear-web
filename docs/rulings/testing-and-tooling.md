# Testing and tooling conventions

Governs where tests live, which suite is allowed to see "renders wrong", and the
selector and assertion traps that have already let defects through a green suite.

**Trigger:** any edit to `e2e/appearance.spec.ts`, `e2e/smoke.spec.ts`,
`e2e/contrast.spec.ts`, `scripts/sourceLint.test.ts`, `scripts/fonts.test.ts`,
`scripts/contrast.test.ts`, `tsconfig.app.json` / `tsconfig.node.json`
`include`/`types`; any new test file under `scripts/`; a new `import ... from
'lucide-react'` outside `src/ui/Icon.tsx`; any `page.evaluate` containing
`querySelectorAll`, `.closest(`, or a `[role="..."]` selector; any assertion
comparing a computed `backgroundColor`; and any test whose expectation you are
about to edit because a restyle made it fail.

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
