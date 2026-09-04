# Design tokens, theme, and layout

Governs every colour, radius, shadow, spacing step, type step and layout
geometry in the app: how the three token tiers are split, how a theme is
declared and applied before first paint, and how the panes, floating editor
chrome and prose column are positioned.

**Trigger:** any change to `src/styles/tokens.css`, `src/styles/index.css`,
`src/styles/editor.css`, `src/styles/themes.ts` (`THEMES`, `DEFAULT_THEME_ID`,
`SYSTEM_DARK_ID`), `src/app/theme.ts` (`applyTheme`, `readMirror`,
`MIRROR_KEY`), the inline `<script>` and the `#boot` indicator in `index.html`,
the `#boot` removal in `src/main.tsx`, `src/ui/Pane.tsx`,
`src/ui/Popover.tsx`, `src/features/account/AccountMenu.tsx`,
`src/ui/Resizer.tsx`, `src/ui/Button.tsx`, `src/ui/Dialog.tsx`,
`src/features/appearance/ThemePicker.tsx`, `src/features/appearance/ThemeDialog.tsx`,
`--bear-dark` and the derived-defaults section of `tokens.css`,
`src/features/editor/RichEditor.tsx`, `src/features/editor/BottomToolbar.tsx`,
`src/features/notes/SearchField.tsx`, `<main>`'s class list in
`src/app/AppShell.tsx`; the `.bear-fold-toggle` / `.bear-fold-badge` /
`.bear-fold-marker` / `.bear-fold-hidden` rules in `src/styles/editor.css` and
`EditorContent`'s own class list in `src/features/editor/RichEditor.tsx`; the
`.bear-section-drop` / `.bear-section-dragging` rules in `src/styles/editor.css`
and `measureBoundaries` in `src/features/editor/HeadingFold.ts`; a
new `--bear-*` custom property or a new `[data-theme='…']` block; any Tailwind
spacing, `rounded-*`, `shadow-*` or `outline-none` utility; a plain CSS
`outline: none` under any `:focus`/`:focus-visible` selector; the six
`--bear-code-*` tokens and their `-l`/`-d` literals in `tokens.css`;
`src/features/editor/highlightClasses.ts` (`ROLE_CLASSES`); and the guards in
`scripts/sourceLint.test.ts`, `scripts/contrast.ts`, `scripts/contrast.test.ts`,
`scripts/fonts.test.ts`, `e2e/appearance.spec.ts`, `e2e/contrast.spec.ts` and
`e2e/smoke.spec.ts`; `src/features/notes/NoteListItem.tsx`'s row structure and
`src/features/notes/thumbnail.ts`; `src/lib/useLayoutMode.ts`'s breakpoints,
`src/app/SidebarDrawer.tsx`, `src/ui/Dialog.tsx`'s `placement`, and
`src/app/paneWidths.ts`'s `SHELL_CHROME_WIDTH` / `maxPaneWidth`.

- **Tokens sit in THREE TIERS, and the split is what the theme system rests
  on.** Tier 1, palette (16 tokens): `bg` `surface` `sidebar` `canvas` `text`
  `muted` `faint` `border` `accent` `danger` `focus` `hover` `selected`
  `shadow` `tag-fill` `tag-fill-strong`. Tier 2, surface treatment (6):
  `radius-sm/md/lg` `shadow-popover` `shadow-dialog` `border-width`. Every
  theme must define all 22, asserted per-theme in `scripts/sourceLint.test.ts`
  against the roster in `src/styles/themes.ts`. Tier 3 — spacing, type, motion,
  the editor measure — is global and **not themeable**: density is a property
  of the app, and a theme able to move it would multiply every screenshot and
  measurement by the theme count. Tier 2 is what lets a theme be flat rather
  than only differently coloured, and what lets High Contrast be an ordinary
  theme instead of a mode every component branches on.

- **`--bear-bg` and `--bear-surface` MUST differ**, in every theme. The app
  uses each as the other's contrast: `SearchField` is `bg-bg` sitting on the
  note list's `bg-surface` pane, while both editor toolbar pills are
  `bg-surface` floating over the editor's `bg-bg`. The indigo mockup had both
  at pure white and every one of those controls was invisible at rest — the
  same defect class as `Button`'s borderless, fill-less `default` variant in
  M5.5. Caught by `e2e/appearance.spec.ts` ("the search field reads as a
  control at rest", "the editor chrome floats as pills clear of the pane
  edges"), not by eye. **The `Button` half of that pairing is historical**:
  M9a moved the note-list header to `ghost`, so `default` — still
  `border-border bg-bg` — now survives only on `ConfirmDialog`'s Cancel, over
  the dialog surface. Restore a `default` button to a `bg-surface` pane and
  this constraint is load-bearing again.

- **The system-dark guard is `:root:not([data-theme])`, NOT
  `:not([data-theme='light'])`.** With named themes, _any_ explicit choice must
  beat the system preference; the old form let every named light theme silently
  lose to a dark OS, a defect invisible to anyone testing on a light machine.
  Asserted both ways in `scripts/sourceLint.test.ts` ("guards the system-dark
  block on the attribute, not on a theme name").

- **Theme blocks are keyed `[data-theme='…']`, never `:root[data-theme='…']`.**
  `:root` matches only the document element, so a theme could not be scoped to
  a subtree — and the picker's swatches are exactly that: each carries its own
  `data-theme` (`ThemePicker.tsx`) and previews its palette by being rendered
  inside it, which is what keeps every colour out of TypeScript. Restoring
  `:root` leaves six identical swatches and an app that otherwise works
  perfectly; only `e2e/appearance.spec.ts`'s "each theme swatch previews its
  own palette" can see it. **A known dead guard, not a reason to change the
  keying:** `sourceLint`'s "has no CSS theme block that is absent from the
  roster" still matches on `/:root\[data-theme='…'\]/`, which the current
  spelling never produces, so that one direction of the roster/CSS agreement is
  vacuous. The other direction — every roster id has a block with all 26
  tokens — is real and is what actually holds them together.

- **`:root` carries the default theme's 26 tokens as well as the tier-3
  globals, duplicating the default's named block.** Do not merge the two into a
  grouped selector: `blockTokens` in the source lint finds a block by `indexOf`
  plus the next brace and cannot read one, and a lookup for `:root {` would
  land on this block anyway. The duplication is guarded by an assertion that
  `:root` and the default block agree, and a second that the
  `prefers-color-scheme` block matches `SYSTEM_DARK_ID`'s.

- **The theme is persisted in the settings table and MIRRORED to
  `localStorage`, read by an inline script in `index.html` before first
  paint.** IndexedDB is async and cannot paint the first frame; without the
  mirror every launch flashes the default. **The mirror is a cache, not a
  second source of truth** — on boot the stored value wins and the mirror is
  rewritten from it, and an unknown mirror value degrades to `system` rather
  than reaching `data-theme`. The roster is duplicated into that inline script
  because a module import would be async and defeat the point; `sourceLint`
  compares the id list, the storage key and the script's position against
  `/src/main.tsx` so none of the three can drift. `system` means the ABSENCE of
  the attribute, never `data-theme="system"`, which would match no block.

- **Every border consumes `--bear-border-width`.** Tailwind's `border`
  utilities hardcode 1px, so without the `@layer utilities` override in
  `index.css` the one theme whose separation depends most on borders would be
  the theme where they stayed hairlines. `e2e/appearance.spec.ts` asserts the
  RENDERED width, because the source cannot show whether a utility was actually
  emitted — the defect that left `--color-hover` dead for two milestones.

- **High Contrast's shadows are hard RINGS, not `none`.** Elevation separates
  nothing on a black ground: with `none`, the sidebar and editor panes merged
  into the canvas entirely — verified by screenshot, not by reading source.
  Expressing the separation through the shadow token keeps the standing ruling
  that a pane carries no border, and means every future floating surface is
  separated there for free rather than having to remember the theme exists.
  Its overlays (`hover`, `selected`, `tag-fill`) are SOLID rather than alpha
  for the same reason: an overlay that composites against its ground is what
  this theme exists to avoid.

- Pane widths are **durable** (`settings` table, via `usePaneWidths`), not
  Zustand state. Zustand is reserved for genuinely ephemeral state and has not
  been added yet.

- **The font families are `'Pretendard Variable'` and `'JetBrains Mono
Variable'`.** `tokens.css` named `'Pretendard'` from M2 to M5.5 with no
  `@font-face` anywhere, so the app silently ran on `system-ui` for five
  milestones. Importing the package alone would not have fixed it — the family
  name must match too. `scripts/fonts.test.ts` compares the token's family
  against the families the shipped stylesheet declares; that is the only form
  of the assertion that can fail.

- **Colour literals outside `tokens.css` fail `npm test`** (not the build), via
  `scripts/sourceLint.test.ts`. The scan is a documented heuristic scoped to
  CSS files and `className`/`style` regions plus arbitrary-value brackets,
  because `#face` and `#dad` are valid hex and valid tags. It counts CSS files
  and component files SEPARATELY: a combined threshold stayed green with the
  whole CSS walk zeroed.

- **Both dark theme blocks must stay token-for-token identical**, asserted by
  `scripts/sourceLint.test.ts`, which compares values and not just key sets. A
  token present in the named dark block but missing from the
  `prefers-color-scheme` block is correct for a user who picked dark and wrong
  for a user whose OS is dark — invisible to every other test.

- **There IS a spacing scale now, and it is enforced.** Permitted steps are
  2 4 8 12 16 24 32 48 px (Tailwind `0.5 1 2 3 4 6 8 12`, plus `0`, `px`,
  `auto` and `full`), checked by `scripts/sourceLint.test.ts`. This REPLACES
  the M5.5–M8 ruling that no scale was needed because Tailwind's grid is
  already 4px: the reasoning about tokens was sound and the conclusion did not
  follow, because **a grid on which every step is permitted is not a scale** —
  ten distinct steps had shipped, and that drift is what read as misalignment.
  Still no competing token system; ordinary Tailwind utilities, with a
  permitted subset. An arbitrary value is an escape hatch that must be
  allowlisted with a stated reason, exactly like the focus-outline suppressors;
  the single entry today is `RichEditor.tsx`'s `pt-12`/`pb-24` toolbar reserve.

- **The editor heading scale is ONE token.** `--bear-heading-ratio` is 1.2 and
  `h1`/`h2`/`h3` are it cubed, squared and itself, so they cannot drift out of
  proportion. **Chosen, not measured** — the Bear figures it replaces were
  never captured trustworthily, and Bear is no longer the authority. The test
  drives the ratio from the page and asserts that raising it moves `h1` by MORE
  than `h3`; an ordering check alone would pass on three sizes that merely all
  changed.

- **UI hierarchy comes from weight and tracking, not size alone.** Five steps
  spanning 11–16px is too little size difference to carry hierarchy, which is
  why the chrome read flat. `--bear-weight-ui-strong` and
  `--bear-tracking-tight` are bound into the `ui-md` and `ui-lg` steps in
  `index.css`'s `@theme inline`, not applied at call sites.

- **A note's first line renders as its title with NO `#` typed, and the
  separator under it is space (`--bear-title-gap`) rather than a rule** — done
  in CSS alone. The document is untouched: no schema, no serializer, no
  round-trip path is involved, and a note opened elsewhere is still the plain
  text the user wrote. `deriveTitle` already treats the first line as the
  title, so this only makes visible a relationship the data layer always had.
  Restricted to `p` and headings — a note opening with a table, code block or
  list has no title line, and styling one as a heading would assert something
  false about the content. The size is stated rather than inherited from `h1`,
  so a note beginning with a paragraph and one beginning with `# Heading`
  present the same title. The gap sits on the SECOND block's `margin-top`, not
  the first block's `margin-bottom`: adjacent margins collapse in a block
  container, so a bottom margin would silently lose to whichever is larger.
  **No round-trip test can see any of this** — it is presentation only — so
  `e2e/appearance.spec.ts` drives plain paragraphs (never `# `, which would
  pass on the heading rule and prove nothing) and asserts the title is larger
  and heavier than the body AND that its gap exceeds the ordinary block rhythm.

- **In Soft Depth the sidebar dissolves into the ground.** Its `--bear-sidebar`
  equals `--bear-canvas` in both indigo themes, and it is `Pane`'s one
  `elevated={false}` caller. Only the panes holding content float. That is a
  PROP and not a `shadow-none` the caller appends, because two utilities in the
  same layer are resolved by stylesheet order rather than class-attribute
  order. The card test in `e2e/appearance.spec.ts` was narrowed from "every
  pane" to "every content pane" for this, and still asserts the sidebar in the
  negative by name (`boxShadow === 'none'`), so it becoming a card again fails
  just as loudly.

- **Motion lives in two duration tokens, never per-component**, so one
  `prefers-reduced-motion` block covers animations added later. `sourceLint`
  asserts that block zeroes both.

- **`danger` and `focus` are separate tokens from `accent`, and since M9a they
  genuinely DIVERGE.** Indigo Light is `#5b4ad6` accent against a `#c62828`
  danger; Indigo Dark and High Contrast diverge too. Only Paper and Ink still
  hold one value in all three slots, which is the historical coincidence this
  bullet was originally written to protect against. Never collapse them: a
  theme with a green accent must not get a green delete button.

- **Tailwind v4 has no `--duration-*` theme namespace.** Durations are written
  `duration-[var(--bear-duration-fast)]`. Adding a `--duration-fast` theme key
  does not produce a `duration-fast` utility.

- **`--bear-faint` was darkened to clear WCAG 3.0 and must not be lightened for
  aesthetics.** Paper `#88857d` measures 3.21:1 on `--bear-sidebar`; the
  original `#9c988f` measured 2.51:1 and failed. Ink is `#7b766e` at 3.40:1.
  `faint` carries counts and timestamps, so 3.0 is already the relaxed bar.
  **"No test can catch this" was true until M9a and is now false.**
  `e2e/contrast.spec.ts` runs in Chromium, which has the real cascade jsdom
  lacks, and gates every theme in the roster on every `npm run test:e2e`. Five
  themes made hand-measurement untenable. Indigo Light's `faint` is the first
  value in this project chosen by a test rather than by eye: the mockup's
  `#9d99b0` measured 2.76:1 on white and 2.31:1 on the sidebar, and it ships
  darkened to `#837e99`.

- **The contrast harness's grounds are AUDITED, not assumed, and its
  calibration is the point.** `scripts/contrast.test.ts` pins the ratios M7.5
  measured by hand, including the rejected 2.51 — injecting that value back
  makes the harness report 2.51, the same figure to two decimals. Without that,
  its verdicts on themes nobody has measured would be worth nothing. It also
  composites alpha overlays (`selected`, `hover`, `tag-fill`) against their
  grounds, which is the half that could never be checked by hand at scale and
  the half jsdom cannot do at all. Two pairs it does NOT check, because the app
  never renders them: **text on `canvas`** (`bg-canvas` occurs once, on
  `<main>`, and every pane paints over it) and **`accent` as text on
  `sidebar`** (a selected row is `text-text` on `bg-selected`; the accent there
  is only the 2px edge marker). `border` is held to 1.05, not 3.0 — WCAG's
  non-text bar covers what is required to identify a control, a row divider is
  not that, and the shipped palettes sit at 1.2–1.4 by design. The floor
  catches an invisible divider and declines to adjudicate subtlety.

- **Exactly two files may suppress the focus outline**, allowlisted in
  `scripts/sourceLint.test.ts`, each mapped to a marker string proving it
  supplies its own indicator: `Resizer.tsx` (`group-focus-visible:` accent
  hairline) and `RichEditor.tsx` (the text caret). The test asserts the
  suppressor set first, so a third file fails before the marker check runs, and
  it matches only `focus-visible:outline-none` — matching the bare form would
  let a file revert to the dead spelling and still pass.
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
  `e2e/appearance.spec.ts` asserts computed `outlineStyle` in a real
  browser on both suppressed elements and, as a control, on an ordinary
  button that is not in the allowlist — the only kind of assertion that can
  actually fail here.

- **`--bear-canvas` is the ground the panes float on, and it is what `body`
  paints.** A browser tab has no window chrome, so depth is what separates the
  panes. The two CONTENT panes carry `shadow-popover` and no border: hard
  borders would compete with the 1px dividers used inside each pane, and
  separating panes by depth while separating rows by line keeps the two jobs
  distinct. (The sidebar is the deliberate exception — see the Soft Depth
  bullet.) `bg-canvas` on `<main>` is redundant with `body`'s own paint and is
  pixel-identical whether present or not — measured twice, independently,
  during M7.5. It stays for a self-contained shell, but a fault injection meant
  to prove "a pane is a card" must target a PANE's own `bg-*` class,
  `rounded-lg` or `shadow-popover`, never `<main>`'s `bg-canvas`; that
  injection is a no-op.

- **The gap between cards IS the resizer.** Before M7.5 it was a 1px hairline
  whose hit box was widened with a negative margin that cancelled out in flex
  layout. `e2e/smoke.spec.ts`'s hit-target test was rewritten in M7.5 because
  the contract changed — that is the one licensed instance; a failing
  geometry or role test during a restyle is otherwise a behaviour report, not a
  stale expectation. The resizer carries no permanent hairline or highlight at
  rest; the visible canvas between two cards is itself the resting cue, ruled
  sufficient rather than adding a dedicated visual affordance. Its arithmetic
  is stated in exactly one place, `<main>`'s class list in `AppShell.tsx`:
  `gap-2` either side of the `w-2` `Resizer`, with `p-2` around the whole
  shell — 24px between cards, 8px to the window edge, measured at 1440x900.
  The hit-target test requires the separator's own width to be at least 6px and
  that `elementFromPoint` returns the separator at both of its edges.

- **REVERSED in sub-project P (2026-09-03): headings, list markers and
  thematic breaks now carry `--bear-accent`.** The struck ruling read
  "Headings keep `--bear-text`; the accent marks what the user can act on or
  has acted on — links, checkboxes, highlight, selection, focus and tag
  pills", on the grounds that a page of accent-coloured headings reads as a
  warning notice, and that in Paper and Ink — where `accent` and `danger` are
  the same value — one colour would mean both "heading" and "delete forever".
  The reversal is the user's, made comparing this editor against Bear side by
  side: the accent reaching the prose is the single thing that makes Bear's
  editor read as a designed document rather than a text field, and structure
  is exactly what a theme's one hue should mark. What survives of the old
  ruling is its Paper/Ink observation, which is now a known cost rather than a
  bar — and the accent is on the MARKER, never on the list item's text
  (`li::marker`), so prose itself is untouched.
  - All six levels, plus the title line's plain-paragraph form
    (`> :is(p, h1…h6):first-child` states `color` for the same reason it
    states `font-size`: a note beginning `# Title` and one beginning with a
    bare paragraph must present the same title).
  - No theme was retuned for this and none needed to be:
    `e2e/contrast.spec.ts` already holds `accent` to 4.5:1 on both `bg` and
    `surface` in all sixteen themes, and the roster's worst is solarized-dark
    at 4.55.
  - `e2e/appearance.spec.ts`'s "the accent reaches headings, list markers and
    rules" is relative, not pinned: it asserts a heading equals the PAINTED
    accent token and differs from a paragraph, so M9a stays free to move the
    palette while a heading that fell back to body colour still fails.

- **In Paper and Ink, prose structure now paints the destructive-action
  colour, and that is ACCEPTED rather than overlooked — decided 2026-09-03,
  by the user, on a screenshot.** Both themes declare `--bear-accent` and
  `--bear-danger` byte-identical (`#cf3b2c` in Paper, `#ff6f5e` in Ink), so
  in 2 of the 16 themes a heading, a list bullet and a thematic break are the
  same colour as a delete affordance. This is the cost the struck M7.5 ruling
  above named as its second reason, and the reversal keeps it deliberately.
  The reasoning, recorded because a later reader will otherwise read it as a
  regression:
  - It reads as terracotta rather than as alarm. At the sizes the accent
    appears in prose — a heading, a hairline rule, a bullet — the hue is warm
    rather than urgent, and that was checked by looking at a render, not
    reasoned about.
  - `danger` is mostly a SOLID FILL, and a fill beside red text still reads
    as the warning: `Button`'s `danger` variant and `PublishDialog`'s
    `DANGER_BUTTON` are `bg-danger text-bg`, and `SyncStatus`/`AccountMenu`
    use it as a status dot.
  - 14 of the 16 themes are unaffected. Indigo Light, Indigo Dark and High
    Contrast all diverge (see the `danger`/`focus` bullet above); only these
    two still hold one value in all three slots, which is a historical
    coincidence rather than a design.
  - **One correction to that reasoning, measured rather than assumed.** It
    was made on the count "only two text uses of `danger`", which is true of
    `src/styles/editor.css` alone (`:430`, a failed code copy; `:1731`, a
    Mermaid render error) and NOT of the app: `NoteRowMenu.tsx:98`,
    `EditorContextMenu.tsx:78` and `TableHandleMenu.tsx:103` each set
    `text-danger` on a destructive MENU ITEM, and `PublishDialog.tsx:348` on
    a status line. Six text uses, four of them in components and three of
    those the exact affordance at issue. The decision stands — those items
    also carry their own words ("Delete", "Delete row") — but the margin is
    thinner than the count it was taken on, so it is written down at its real
    size.
  - **What reopens this:** a delete affordance in Paper or Ink that stops
    reading as dangerous. Concretely, a red menu item whose label alone no
    longer distinguishes it from the accented prose behind it, or a report
    from real use that a destructive action was taken by mistake in one of
    those two themes. The fix then is NOT to un-accent the prose — that
    reverses a decision made by looking at renders — but to let those two
    themes diverge `danger` from `accent` the way the other fourteen already
    do. Nothing enforces the identity; it is two lines in `tokens.css`.

- **Table rows alternate, and both the stripe and the header shade are DERIVED
  from `--bear-bg` in `srgb`** — `--bear-table-stripe` at 94%/6% and
  `--bear-table-header` at 88%/12% toward `--bear-text`. Three things here are
  measured rather than chosen, and each was wrong on the first attempt:
  - The ground is `bg`, not `surface`. The editor pane is `bg-bg`
    (`AppShell.tsx`), so a cell with no background of its own paints on
    `--bear-bg`; a stripe mixed off `surface` is a step away from a colour the
    row is not sitting on, and in oklab it lands DARKER than the header it is
    meant to sit under.
  - The space is `srgb`, against this file's general preference for `oklab` on
    opaque mixes. oklab's L is perceptually uniform, which is what lets one
    ratio serve sixteen palettes for a TEXT tier — but these are a step off
    the BACKGROUND, and a 6% step in L from a pure black falls outside the
    sRGB gamut and clamps straight back to black. Measured: `color-mix(in
    oklab, #000000 94%, #ffffff)` resolves to `#000000`, so `high-contrast`'s
    stripe scored **1.004** against its own background. Do not tidy this back
    to oklab.
  - The header was `--bear-surface` before this, which is why `high-contrast`
    had no header shade at all: that theme's `bg` and `surface` are both
    `#000000`.
  `e2e/contrast.spec.ts` holds both halves — `text` at 4.5:1 on each ground
  (worst in the roster: solarized-dark, 8.16 on the stripe and 7.10 on the
  header), AND each ground at `border`'s own 1.05 visibility floor against
  `bg`. The second row is not redundant: a stripe that had collapsed into the
  page passes the first one perfectly, because it IS the page. Reverting the
  mixes to oklab fails exactly that floor, on `high-contrast`, with
  `table-stripe on bg: 1.00 < 1.05`.

- **Both editor toolbars float; they are not bars in the flow, and their
  placement lives in `RichEditor`, not in either toolbar.** From M4 to M7.5 they
  were full-width strips welded to the pane's top and bottom edges, which
  measurement against Bear identified as the single largest reason the editor
  read as a web page rather than an app (see the measured comparison in
  `docs/design/DESIGN-bear-web.md`). `TopControls`, `InfoPanel` and
  `BottomToolbar` are now bare groups of controls with no layout of their own,
  and `RichEditor` positions all three (`inset-x-3 top-3` and `inset-x-3
bottom-3`), so the pill offsets are stated once together and cannot drift
  apart. `e2e/appearance.spec.ts` asserts each pill is inset on all four sides,
  fully rounded (radius at least half its height), filled with something that
  is neither transparent nor equal to its ground, and shadowed. Three
  consequences that are load-bearing rather than stylistic:
  - **The writing surface's `pt-12` is a reserve, not spacing; its `pb-24`
    was a reserve that never reached the content, and the real bottom reserve
    is now `.ProseMirror::after` driven by `--bear-editor-pad-bottom`.** The
    pills overlay the prose, so without a bottom reserve the last line of
    every note sits permanently behind the formatting bar with no way to
    scroll it clear — and the note still round-trips perfectly, so nothing but
    a computed-style test can see it. `pb-24` did not prevent that, and the
    test that was supposed to guard it could not tell:
    `e2e/appearance.spec.ts`'s "the writing surface reserves room for the
    floating toolbars" compares a PADDING VALUE (96px) against a pill's reach
    (48px desktop, 68px coarse) and never asks where the padding ended up.
    `.ProseMirror` is `min-h-0 flex-1` inside `EditorContent`'s column flex
    container, so its used height is exactly the scroll container's height
    however long the note is, and the prose overflows its own box; the padding
    therefore sits at the bottom of a container-height box, which on a
    scrolled note is nowhere near the end of the content. Measured 2026-09-03
    on a 41-line note scrolled to its end: `padding-bottom` 96px,
    `.ProseMirror`'s own bottom edge at viewport y = **-186** (off the top of
    the viewport), the last line at 686.7-712.3 and the toolbar pill at
    664-700 — the last line squarely behind it. The fix is a `::after` block,
    which is a real box in flow after the last child and so moves with the
    content and lands inside the scrollable overflow region; a margin on
    `> :last-child` was rejected because a bottom margin is not reliably part
    of scrollable overflow, i.e. the same silent failure again.
    `--bear-editor-pad-bottom` is tier 3 (not themeable) and is 4rem, with
    5.25rem under `@media (pointer: coarse)` — each the pill's measured strip
    plus a 16px gap. The query is `pointer: coarse` rather than a width
    breakpoint because that is the query `coarse:h-14` — the thing being
    cleared — is itself written against; a width breakpoint would disagree
    with the toolbar on a touch laptop. `pb-24` is left in place as inert
    (a note short enough for its padding to be on screen never scrolls at
    all) and remains the one allowlisted off-scale spacing value in
    `scripts/sourceLint.test.ts`. The assertion that can actually fail is
    "the last line of a long note scrolls clear of the toolbar", which
    compares two bounding boxes with the note scrolled to its end.
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
  clamping. The e2e test therefore asserts a LOWER bound too
  (`min(--bear-line-width, pane width)`), not just "narrower than the pane",
  which a collapsed column would also satisfy.
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
  entirely. (The title-gap rule is `(0,2,0)` and wins on specificity instead,
  which is why it is stated once.) The guard matters more than the wiring: a
  declared token no rule consumes is indistinguishable from a token that does
  not exist, Tailwind and CSS both emit nothing and say nothing, and this
  project has now shipped that defect three times (`--color-hover`,
  `--bear-line-width`, and these two). `e2e/appearance.spec.ts`'s "the editor
  typography tokens reach the rendered prose" sets each token from the page and
  asserts the render moves; all three halves were verified by fault injection,
  including restoring `56em`.

- **The tag pill sets `box-decoration-break: clone`.** A pill that wraps mid-tag
  otherwise gets ONE box sliced through the break — the fragment before it loses
  its right edge and radius, the one after loses its left — which reads as a
  rendering fault rather than a wrapped chip. Latent from M7.6 until M8 narrowed
  the measure to 40em, at which point a mid-tag wrap became common rather than
  rare.

- **`SearchField` suppresses the native `type="search"` cancel widget**, via
  `[&::-webkit-search-cancel-button]:appearance-none` and the matching
  `search-decoration` rule. Chromium renders its own X inside a search input,
  which sat beside our own labelled clear button — two clear affordances in one
  freshly designed field. `type="search"` stays (it is what makes the
  `searchbox` role and its tests hold); only the native widget's rendering is
  suppressed.

- **The fold toggle and badge are absolutely positioned at a negative inline
  offset from the heading (`-3rem` and `-1.5rem`) — their OWN offsets never
  changed and are not a reserved lane on the heading or prose.**
  `.bear-fold-badge`'s `-1.5rem` exactly cancels `.ProseMirror`'s own `1.5rem`
  padding, so the badge always lands flush with the prose column's own edge —
  it is effectively always visible, at any pane width, and never usefully
  distinguishes a "gutter" state from an "overlay" one. The toggle, one
  badge-width further out at `-3rem`, is the one that actually reaches past
  `.ProseMirror`'s own box into the real gutter — the free space between the
  note-list pane and the editor pane's content, measured in `editor.css`'s own
  comment at 88px at 1440x900. (`.ProseMirror`'s own `max-width` DOES
  conditionally reserve a lane on the surrounding container below a
  threshold — see the next bullet — but that is a separate mechanism from
  these two fixed offsets, which is why this bullet and the next do not
  contradict each other despite both using the words "reserve a lane.")

- **The gutter used to be real screen space only when the pane was wider
  than the clamped measure, and below that the toggle was not merely
  "overlapped" but genuinely CLIPPED — this was a real, shipped bug, found by
  this task's own browser coverage and fixed in the same task, not filed as
  an accepted limitation.** `EditorContent` (`RichEditor.tsx`, the direct
  parent of `.ProseMirror`) sets `overflow-auto` for vertical scrolling, and
  — the same "a `visible` axis paired with a non-`visible` one computes to
  `auto`" CSS quirk already on record here for `BottomToolbar` — that clips
  the horizontal axis too, at `EditorContent`'s own box edge. `margin-inline:
  auto` only ever gives `.ProseMirror` `(EditorContent width − measure) / 2`
  of margin on each side, and below ~688px of pane width (this project's own
  default pane widths land the editor pane at 656px, already under that
  line) that margin fell under the toggle's own `1.5rem` reach past the
  column's own edge, so most of its box fell OUTSIDE `EditorContent`'s edge —
  genuinely clipped, not merely covered. A real Playwright `.click()` at the
  toggle's visual center missed the button and landed on the app shell
  instead, reproduced at the suite's own default 1280x720 viewport. The fix
  (`editor.css`) is `.ProseMirror`'s `max-width: min(var(--bear-line-width),
  100% - 3rem)`: `min()` makes the `3rem` reservation a no-op above ~688px
  of pane width, where the achieved reading width is untouched, and only
  below that width does it reserve a guaranteed `1.5rem` of margin on each
  side — exactly the toggle's own reach, no more — so the toggle's edge
  lands exactly at `EditorContent`'s own edge rather than past it. (An
  earlier version of this fix used `6rem`/`736px`/twice the needed margin
  as deliberate slack; review correctly identified that as reserving more
  than necessary, at a real cost — see below — so it was tightened to the
  minimum sufficient value.) A separate `min-width: 12rem` is the floor:
  `max-width` alone has no lower bound — it can only ever SHRINK an item
  below its other constraints, never grow it past them, so nesting a
  `max(12rem, …)` INSIDE `max-width` does not work (measured directly: the
  rendered width still fell below `12rem` at a narrow pane) — and a narrow
  enough pane would otherwise collapse the column to a genuinely
  zero-or-negative width with nothing to catch it, verified directly
  against a 76px container. Only `min-width` can force the item past its
  flex container's own width, letting it overflow `EditorContent`
  (scrollable, via the same `overflow-auto` already on that element) rather
  than collapse. `12rem` guarantees the column never disappears,
  independent of the `3rem` reservation above. Narrowing the rendered
  column below the raw 40em token in the 640-688px pane-width band (656px
  pane → 608px column, not 640px), where it previously achieved the full
  measure, is the deliberate, disclosed cost of this fix — a real narrowing
  the earlier "reserve a lane" rejection did not anticipate, and accepted
  rather than reserving the lane on the heading or prose itself, which
  would have narrowed the column at every pane width instead of only this
  one band. `Mod-Alt-f` remains the one route that never depended on pane
  width at all, before or after this fix.

- **The persistent folded cue (`.bear-fold-marker`, the inline "…") sits at
  the END of the heading's own line, inside the measure — deliberately not in
  the gutter.** A gutter-positioned persistent mark would overlay prose text
  at rest on a narrow pane, exactly the failure mode the hover-only rule for
  the toggle and badge exists to prevent. Putting the "this section is
  folded" cue inline instead means it never overlaps anything: it is ordinary
  flowed content, sized and coloured (`--bear-faint`) like the rest of the
  heading.

- **`overflow-hidden` on the sidebar `Pane` clips popovers; it is not a
  z-index problem.** The sidebar `Pane` (`src/app/AppShell.tsx`) is given
  `overflow-hidden` via its `className` prop so the tag tree scrolls under a
  pinned footer. That clips any absolutely-positioned descendant wider than
  the pane — at the 240px default sidebar, a 256px `AccountMenu` lost 56px
  and cut its disclosure line mid-sentence. It presents exactly like a
  stacking-order bug and is not one: nothing is painted over the missing
  edge, so **raising `z-index` changes nothing.** The fix
  (`src/features/account/AccountMenu.tsx`) is `position: fixed` with
  viewport coordinates computed in `useLayoutEffect`, which escapes the clip
  **only because no ancestor establishes a containing block** — there is no
  `transform`, `filter` or `will-change` anywhere in the layout today.
  **Adding one above a popover would silently re-clip it**, which is the
  part worth writing down; `src/ui/Popover.tsx`'s own `style` prop exists
  specifically because a computed fixed placement cannot be expressed as a
  static class. `ThemePicker` (`className="... w-44"` on its `Popover`, i.e.
  176px) has the same latent bug — `absolute`, not `fixed` — and fits only
  because it stays inside the pane at the 240px default sidebar; it would
  clip at the `MIN_PANE_WIDTH` (160px, `src/app/paneWidths.ts`) floor. It is
  currently unfixed — record it as known, not as resolved.
  A clipped element still reports its full, unclipped layout rect, so a
  bounding-box assertion cannot see this at all. `e2e/account.spec.ts`
  probes with `document.elementFromPoint` at the menu's far edge instead,
  and the test was verified by injection to fail with "the menu is clipped:
  its right edge is not painted" when the `position: fixed` fix is reverted.

- **The four `--bear-hl-*` highlight fills are TRANSLUCENT on purpose, and
  that is what keeps them out of the contrast budget.** A highlight is body
  text on a tinted page. An opaque fill would need its own foreground token
  per colour per theme — twenty more values, each a separate contrast pair —
  whereas alpha over `--bear-bg` leaves `--bear-text` reading through it
  unchanged. `--bear-selected` already worked this way and these follow it.
  `high-contrast` is the deliberate exception: it uses opaque hex like every
  other token in that block, chosen dark enough that white clears 4.5:1.
  `e2e/contrast.spec.ts` composites all four over `bg` and asserts the floor,
  so a "nicer" saturated fill fails there rather than shipping unreadable.

- **The DEFAULT highlight has no token of its own and must not get one.** It
  is `--bear-selected`, which is what every `==text==` in every existing note
  has always rendered as. Giving it a `--bear-hl-yellow` would create two
  spellings of one thing — `==x==` and `<mark class="hl-yellow">x</mark>`
  render identically but serialize differently — and the plain form has to
  win, because it is what the notes already contain.

- **The table bar is `position: relative` with a negative margin, never
  `absolute`.** `EditorContent`'s `overflow-auto` clips top and left overflow
  — the same constraint that made B1's fold gutter a reserved column rather
  than an overlay — so a bar hanging outside the flow is cut off above a table
  at the top of a note. It also has to stay INSIDE the scrolling content:
  `fixed` off a `getBoundingClientRect()` (how `HeadingMenu` is placed) is
  right for a menu that closes on the next click and wrong for chrome that
  stays up for as long as the caret is in the table, because it drifts on
  scroll.

## F — derived theme defaults

- **Derivation provides DEFAULTS for new themes; it does NOT reconstruct the
  five that shipped before F, and measurement is why.** `muted`, `faint` and
  `border` look like `text` mixed toward `bg` — their lightness fits a
  constant ratio in both sRGB and oklab, which is what makes the theory
  convincing — but their CHROMA does not. `indigo-dark`'s `muted` is
  `(169, 163, 189)`, visibly violet, where the fitted mix gives a near-grey
  `(165, 162, 173)`. No single ratio reproduces all four themes; the best fit
  is off by up to 17/255 per channel. The alphas are hand-tuned too
  (`selected` is .09, .11, .18, .20 across four themes) and their ratios to
  one another are not constant either. Only `focus` derives exactly: it is
  `accent` in all five. The five shipped themes therefore declare every value
  explicitly, and `e2e/themeBaseline.spec.ts` pins them against a fixture
  captured before derivation landed.

- **A change to a derivation ratio in `:root` changes ELEVEN themes at once,
  and only the contrast floors will notice.** The five pre-F themes are pinned
  per-token by `e2e/themeBaseline.spec.ts`; the eleven derived ones are not
  pinned at all, because there is no "before" for them to drift from and a
  ratio change is *supposed* to move them. So editing `68%`, `51%`, `13%` or
  any of the five alpha scalars is a restyle of two thirds of the roster, and
  the only thing standing between it and `main` is `e2e/contrast.spec.ts`
  finding a floor violation — which a drifted-but-still-legible colour will
  not produce. This is a deliberate choice, not a gap to fill: extending the
  baseline fixture to all sixteen would make every intentional tweak a fixture
  churn, and the floors are the right gate for a derived palette. Consequence:
  run `npm run shots` and look at the light and dark grids before committing a
  ratio change, because nothing else in the six gates can see it.

- **The `:root` agreement tests in `sourceLint` compare the FULL token set,
  and that depends on the default theme being a hand-written one.**
  `DEFAULT_THEME_ID` is `indigo-light` and `SYSTEM_DARK_ID` is `indigo-dark` —
  both pre-F, both declaring all 26 — which is why
  `keeps the no-choice block identical to the default theme block` can iterate
  `REQUIRED` rather than `BASE`. Point either constant at a derived theme and
  most of that assertion compares `undefined` to `undefined` and passes
  vacuously. The F spec predicted these tests would have to narrow to `BASE`;
  they did not, and the spec has been corrected.

- **The default palette lives in `:root:not([data-theme])`, NOT in `:root`,
  and moving it back would silently kill the derived defaults.** A literal in
  `:root` beats a derived value in the same block AND applies to every theme
  that does not override that token. With the palette there, a theme
  declaring only its eight base colours inherited the default's `muted`,
  `faint`, `border` and `focus` — measured with a probe theme whose accent
  `#7fd1c1` resolved `--bear-focus` to `#5b4ad6`. Every test passed, because
  the five shipped themes override everything and never reach the derived
  section. `:not([data-theme])` cannot match a themed root, so the conflict
  disappears rather than being won on specificity. `sourceLint` now asserts
  `:root` does NOT define a base token.

- **`--bear-dark` is a NUMBER (0 or 1), and it is not `themes.ts`'s `group`.**
  A number so `calc()` can interpolate the five alpha scalars from one
  declaration per theme instead of five. Separate from `group` because `group`
  decides how the PICKER files a theme and is deliberately hand-declared —
  `high-contrast` is dark by intent, and deriving the grouping would make it a
  side effect of a colour edit. A theme wanting something between the two
  schemes may say `0.5`, which no grouped selector could express.

- **Two colour spaces, and nothing enforces the split.** `oklab` for the
  opaque mixes, because perceptual evenness is the only reason one ratio can
  serve sixteen palettes — an sRGB midpoint lands visibly darker in some hues
  than others. `srgb` for the alpha tints, because mixing with `transparent`
  in `oklab` interpolates through a premultiplied space and shifts hue as it
  fades, which is not the plain alpha these tokens have always been. A token
  added in the wrong space compiles, renders, and looks subtly wrong in a way
  no test can see.

- **The geometry tokens are NOT unified, deliberately.** There are three
  radius families in `tokens.css` (`paper`/`ink` at 4/6/10, the indigo pair at
  6/8/12, `high-contrast` at 2/4/6) and three shadow treatments. `:root`
  carries the indigo family as a default so a new theme inherits a complete
  look from its eight colours; collapsing the others into it would silently
  restyle two shipped themes, which is a restyle wearing a refactor's clothes.

- **Adding a theme touches FOUR places, and one of them fails silently.** A
  row in `themes.ts`, a block in `tokens.css`, a label in both locales, and
  the id in `index.html`'s pre-paint `var known = [...]`. The script cannot
  import the roster — a module import is async and the point is to run before
  first paint — so the list is a deliberate duplicate. A theme missing from it
  still works; it just flashes the default before React corrects it, which no
  test but `sourceLint`'s "lists exactly the roster ids" can see.

- **Fidelity to an upstream palette loses to legibility, and the harness
  decides.** Nine of the eleven themes F added needed at least one value
  moved to clear a contrast floor, in both directions — light themes fail by
  having too-light accents, dark themes by having too-dark ones against their
  own surfaces. Solarized fails at BOTH ends of its own range. Every
  adjustment is the computed minimum and is recorded in the block beside the
  upstream value it replaced. Do not lower a floor to keep a palette
  faithful.

- **The syntax palette (sub-project C) is SIX roles — keyword, string,
  number, comment, function, type — as twelve fixed literals (`-l`/`-d` per
  role), interpolated on `--bear-dark` exactly like every other derived
  token: `color-mix(in oklab, ROLE-l calc((1 - var(--bear-dark)) * 100%),
  ROLE-d)`.** Unlike `muted`/`faint`, these are NOT derived from a theme's own
  palette — they are the same twelve literals for all sixteen themes, only
  the mix ratio moves. A change to any `--bear-code-*-l` or `-d` literal
  therefore moves **fifteen** themes at once, not one — every theme except
  `high-contrast`, which overrides the derivation entirely (below). Treat
  `tokens.css`'s `:root` code-literal block the way `muted`/`faint`'s ratios
  are treated: a shared value with a sixteen-theme blast radius, not a
  per-theme constant.

- **`code-comment` clears its contrast floor at `3.0`, not `4.5`, and this is
  the only relaxed floor in the roster.** It borrows `--bear-faint`'s own
  justification (`e2e/contrast.spec.ts`): a comment is decorative-tier text,
  not content, the same reasoning that lets `faint` clear at 3.0 while `text`
  and `muted` must clear 4.5. Do not tighten `code-comment` to 4.5 without
  first re-litigating `faint`'s floor, since the two rest on the same
  argument.

- **`high-contrast` carries its OWN six `--bear-code-*` overrides
  (`tokens.css`, its `[data-theme='high-contrast']` block) rather than
  inheriting the derivation.** Its surface is literal `#000000`, and the
  shared twelve-literal palette was tuned against every OTHER theme's
  surfaces — none of them pure black. Reusing the derivation there under-
  saturates against true black; the override block exists so this one theme
  is not a hidden exception living inside a "works for all sixteen" formula.
  A future syntax-palette change must check `high-contrast`'s six overrides
  separately; they will not move with the shared literals and will not be
  caught by a test that only samples the derived fifteen.

- **Two contrast margins in the syntax-palette roster are hair-thin, known,
  and not surprises.** `sepia`'s `faint` clears its 3.0 floor by **0.02**
  (3.02); `gruvbox-light`'s `code-number` clears its 4.5 floor by **0.051**
  (4.5512). Both are the tightest of their respective floor's roster
  (`code-comment`'s tightest is nord at 3.272, a full order of magnitude
  looser). Nudging either theme's `bg` or `text` will very likely turn
  `e2e/contrast.spec.ts` red — that is correct, not a regression in the
  guard, and this bullet exists so it is not mistaken for one.

- **A major pre-existing defect: `parseColour` in `scripts/contrast.ts` was
  blind to `oklab()`, and the harness had been silently PASSING nine themes
  below WCAG AA since sub-project F shipped (2026-08-20).** The fallback
  stripped an `rgb(` prefix that was never there and returned `NaN`;
  `contrast.spec.ts` collects a failure on `ratio < min`, which is FALSE for
  `NaN`, so an unreadable pair passed silently. Found only because proving
  `--bear-dark`'s interpolation "genuinely mixes, not merely selects" (C's
  own palette probe) required teaching `parseColour` to read `oklab()` —
  Chromium's serialization for an out-of-gamut `color-mix(in oklab, …)`, which
  every DERIVED `muted`/`faint` produces. With the fix, nine themes failed
  outright (solarized-light, rose-dawn, latte, gruvbox-light, snow,
  solarized-dark, gruvbox-dark, tokyo-night, sepia); worst case was `faint` on
  sidebar at 2.05 against a 3.0 floor. Fixed two ways, both load-bearing:
  `parseColour` now THROWS on any unrecognised colour notation instead of
  returning a sentinel, and `contrast.spec.ts` treats a non-finite ratio as a
  failure independently of the throw (belt and suspenders — either one alone
  would have caught this class). Six themes' `--bear-text` moved to clear the
  floors once the harness could see them (solarized-light, rose-dawn, latte,
  gruvbox-light, snow, solarized-dark); the derivation ratios themselves
  (`muted` 68%→72%, `faint` 51%→56%) also moved, inside the range F's own spec
  measured, rather than distorting the design language to paper over marginal
  base palettes. **This was predicted in writing and not acted on**: an
  earlier entry in this project's toolchain notes, after a `color(srgb …)`
  instance of the identical failure shape, says outright that "any future
  colour function (`lab()`, `oklch()`) reaching a computed value needs the
  same treatment, and the failure mode is silence, not a crash." The lesson
  is not "fix `oklab()` too" — it is that a `parseColour`-shaped guard must
  reject the unknown by default, not pass it by default, because the next
  colour function is not enumerable in advance either.

- **The focus-outline suppression guard (`scripts/sourceLint.test.ts`, "lets
  only known files suppress the outline") walked `.tsx` files only, and a
  plain CSS `outline: none` under a `:focus`/`:focus-visible` selector was
  invisible to it.** This shipped once (`.bear-code-language-list:focus {
  outline: none }`, sub-project C) past a fully green suite; the suppression
  was later dropped rather than allowlisted, but the class of gap survived
  until this task closed it. The guard now also walks `.css` files under
  `src/` (excluding `tokens.css`), matching an `outline: none`/`0` declaration
  whose enclosing selector carries `:focus`/`:focus-visible` — careful to
  exclude `src/styles/index.css`'s global `:focus-visible` rule, which DEFINES
  the ring rather than suppressing it. Any new CSS suppressor must be added to
  `OUTLINE_SUPPRESSORS` with its own marker, exactly like the two `.tsx`
  files already there. This is the same shape as the `parseColour`/`oklab()`
  defect above: a guard that proves the property it was written for while a
  defect walks one step around it.


## The note-list row (M9c)

- **The date sits on a FOOTER line, under the preview, not between the title
  and it.** M9c's redesign. The eye lands on the title and continues into the
  note's own words; a timestamp in that position is a step over something the
  reader did not ask for. `NoteListItem` is a flex column and its DOM order IS
  its visual order, which is what makes the ordering assertable in a unit test
  at all (`NoteListItem.test.tsx`'s `row layout` suite reads positions out of
  `textContent`).

- **The pin moved onto that footer line and is absolutely positioned, which is
  not a styling preference.** It cannot be a child of the row's select button —
  a `<button>` inside a `<button>` is invalid HTML and unclickable in some
  browsers (`accessibility.md`), and that rule is pinned by a test asserting
  no `button button` exists in the row. So the pin is a SIBLING, laid over the
  footer line, and the date carries `pl-6` to reserve its slot. Those two
  numbers are a pair: the pin's box runs from 8px to 30px (`left-2` plus
  `p-1` around a 14px glyph) and `pl-6` puts the date at 36px from the row's
  edge. 20px (`pl-5`) was the tighter fit and is OFF `sourceLint`'s permitted
  spacing scale — the guard caught it, which is what the guard is for.

- **An unpinned row's pin is hidden at rest and revealed on hover or focus;
  a pinned one is always drawn.** On the old right-edge position a faint pin
  read as a control. On the metadata line it reads as STATE, and a state
  marker drawn on every row says "pinned" about notes that are not. What
  makes hiding it safe is the row's context menu: Pin/Unpin lives there too,
  so hover is no longer the only route, which is exactly the objection that
  kept the pin drawn before M9c. `opacity`, never `hidden` — the button must
  stay in the DOM, in the tab order, and keep announcing `aria-pressed`
  regardless of hover — and `group-focus-within` is what stops it becoming an
  invisible tab stop. **`toBeVisible()` ignores `opacity`**, so the only test
  that can see this rule is a `toHaveCSS('opacity', …)` read before and after
  the hover; `e2e/notes.spec.ts` does that, the same way the table handles'
  reveal is covered.

- **The preview reserves its height; the thumbnail does not.** Reserving the
  snippet's two lines is what keeps rows uniform whether or not a note has a
  body. Reserving space for a thumbnail would do the opposite: most notes name
  no image, so every one of those rows would carry a permanent hole. The
  thumbnail has a fixed HEIGHT (`h-16`) and a free width, so the images share
  a baseline down the list however differently they are shaped — a fixed width
  would not give that.

- **The row shows an image the editor deliberately shows as text, and that is
  a known inconsistency, not an oversight.** This app stores no images;
  `RawImage` renders `![alt](url)` as its own muted monospace source, and
  image storage is unscheduled. `thumbnail.ts`'s `firstImageUrl` therefore
  reads the first REMOTE image URL out of the note's Markdown — the only image
  source that exists — skipping fenced code blocks, and admitting only
  `https:` and `data:image/*`. `http:` is excluded because the app is served
  over HTTPS and a plaintext image is blocked as mixed content, which would
  render as a broken box on every row that named one; a non-image `data:`
  media type is excluded because admitting a scripting type into an `<img
  src>` on the grounds that today's browsers ignore it is not a bet worth
  taking. A URL that fails to load unmounts itself (`onError`), keyed on the
  URL so an edited note gets a fresh attempt.


## The responsive shell (J1)

- **Three modes, two breakpoints, and 1024 is chosen against a CONSTRAINT
  rather than by taste.** `phone` below 640, `tablet` 640–1023, `desktop` at
  1024 and above. `playwright.config.ts` runs `devices['Desktop Chrome']` at
  1280×720, so a desktop breakpoint at or below 1280 keeps valid the seven
  existing e2e assertions that the shell has three panes
  (`codePalette.spec.ts:19,39,107`, `contrast.spec.ts:138`,
  `appearance.spec.ts:302,418,901`). Lowering the configured viewport below
  1024 would turn all seven into confusing failures about missing panes;
  `e2e/mobile.spec.ts` carries one named assertion that fails honestly
  instead. 640 is a comfort threshold and says so: two panes physically fit
  from ~520px, but at 640 the editor gets ~280px, the narrowest column worth
  writing a sentence in.

- **The mode comes from a hook, not from CSS, for four reasons CSS cannot
  address.** The resizers must not MOUNT; the drawer needs open state and a
  focus trap; `Pane`'s width is an inline style; and the shell renders a
  different set of children per mode. `useLayoutMode` seeds from `matchMedia`
  during the FIRST render, never an effect — there is no SSR here, and an
  effect-seeded value paints one frame of the wrong layout on every load. Its
  test asserts the first value the hook ever returns, which is the only
  assertion that can see that.

- **A resizer is NOT RENDERED below desktop, never hidden.** `Resizer` is a
  focusable `separator` carrying `aria-valuenow`; `display: none` takes it off
  the screen while leaving it in the tab order and the accessibility tree,
  which is worse than either showing it or not building it.

- **A tablet's note list keeps its STORED width; only a phone's fills.**
  `Pane` treats `width={undefined}` as `flex-1`, so giving every sub-desktop
  pane `undefined` makes the list and the editor both `flex-1` and split the
  screen in half — a 400px note list beside a 400px editor. Caught in the spec
  review, before it shipped.

- **Pane widths are WRITTEN in desktop mode only.** They are read in every
  mode, so a phone session cannot overwrite the widths chosen on a desktop and
  returning to a wide window restores them exactly.

- **`SHELL_CHROME_WIDTH` is a constant, and one e2e test is what makes it
  falsifiable.** 16 of padding + 32 of gaps + 16 for the two `w-2` resizer
  tracks = 64. It shipped as 56, forgetting one resizer, and
  `e2e/mobile.spec.ts`'s narrow-desktop test caught it on its first run: the
  editor measured 152px against a 160 floor. If the shell's padding or gaps
  ever change, that test fails and this constant is what to fix.

- **`Dialog` gained a `placement` prop; the drawer must not append overriding
  utilities.** The centring lives on the backdrop wrapper rather than the
  panel, and the panel's own `mx-4`/`rounded-lg` are utilities in the same
  layer as anything appended — resolved by stylesheet order, not by the class
  attribute's. `placement` OMITS classes instead, which is the same rule
  `Pane`'s `elevated` follows.

- **The search input is 16px at every width, and that is a bug fix rather
  than a typography choice.** `--bear-text-ui` is 13px, and **iOS Safari zooms
  the whole page when an input below 16px takes focus**, leaving the user
  zoomed in with no way back but pinching. `--bear-text-ui-lg` is exactly
  1rem. It is applied unconditionally rather than at the phone breakpoint: a
  desktop field at 16px costs nothing, and branching on layout mode would make
  the rule invisible at exactly the size where it matters. The unit test can
  only check the class name; `e2e/mobile.spec.ts` asserts the COMPUTED
  `font-size`, which is what fails if the token moves.

- **The FAB carries `env(safe-area-inset-bottom)`, and the list carries
  padding to scroll past it.** General safe-area handling is J4, but a
  floating control placed in the exact spot the OS reserves for the home
  indicator cannot wait for it. The list's bottom padding is a `style` rather
  than a utility because the needed 64px is off `sourceLint`'s permitted
  spacing scale and because it must add the same inset. **Found in a
  screenshot, not by a test:** without it the FAB permanently covers the last
  row's preview, and nothing in the suite can see that.


- **A sidebar row is 44px with a 16px label in the drawer, 32px with 13px in
  the desktop pane.** `SidebarRow` takes a `touch` prop rather than reading a
  media query itself — `src/ui/` holds primitives that know nothing about the
  app's layout modes, the same reason `Resizer` takes `min`/`max` rather than
  importing the pane-width constants. The 32px row was measured against Bear's
  DESKTOP row; its phone rows are ~44px, and at 32/13 the drawer read as a
  shrunken desktop sidebar on an iPhone.

## Touch parity (J2)

- **Two queries, and collapsing them into one is a regression even though no
  device separates them.** `(hover: none)` gates the REVEALS — it is the
  literal statement "this control can never be revealed", which is the defect
  J2 exists to fix. `(pointer: coarse)` gates TARGET SIZE and the long-press
  gesture — the literal statement "the pointer is a fingertip". They agree on
  every device this app will meet; the point is that each rule reads as the
  reason it exists. `src/lib/useCoarsePointer.ts` exports `HOVER_NONE_QUERY`
  solely so a unit test can prove the two have not been merged by a
  well-meaning simplification.

- **The `touch:` variant is DECLARED, not borrowed.**
  `@custom-variant touch (@media (hover: none))` in `src/styles/index.css`.
  Tailwind may ship a built-in for this query under some name; using it would
  tie the app's touch behaviour to a minor upgrade's naming, and the failure
  mode of a variant that stops matching is Tailwind's usual one — no warning,
  no error, the utility simply never emitted. That is exactly how
  `hover:bg-hover` stayed dead from M4 to M5.5.

- **Hit areas grow; ink does not — EXCEPT in menus, where it is reversed, and
  the reversal is the correct call.** `touch-target` / `touch-target-y` expand
  a control to 44px with a pseudo-element, so no pane reflows and
  `npm run measure`'s 27 surfaces keep their numbers. A menu is the one place
  that is wrong: menu items are a VERTICAL list about 26px tall, so a 44px
  overlay on each overlaps its neighbours by 9px top and bottom, and a
  near-miss then selects the WRONG command — which in `NoteRowMenu` includes
  Delete. Overlapping targets are strictly worse than small ones. Menu items
  therefore grow `min-height`, which is safe precisely because a popover
  growing taller reflows nothing outside itself.

- **The menu rule is applied by ARIA ROLE, and that only works because these
  roles are explicit.** One declaration covers `[role='menuitem']`,
  `[role='menuitemradio']` and `[role='menuitemcheckbox']` — 40 attributes
  across ten menus, all written into the JSX. An IMPLICIT role would match
  nothing: `docs/rulings/testing-and-tooling.md` records the audit where
  `[role="region"]` silently matched no `<section aria-label>` at all. Do not
  extend this rule to a role the app does not write out.

- **Two clusters cannot reach 44 in both axes, and both say so where they are
  declared.** `BottomToolbar`'s buttons are 32px wide at a 34px pitch, and the
  fold gutter's toggle and badge sit exactly adjacent at `-3rem` and `-1.5rem`
  — so a 44px-wide expansion would put each inside its neighbour. They land at
  32×44 and 24×44 respectively. 24px still clears WCAG 2.5.8 (AA); the 44 this
  project usually holds is 2.5.5 (AAA) and Apple's HIG figure, and
  `Button.tsx` cited the wrong one of those two for a milestone.

- **`BottomToolbar` cannot carry the hit-area utility at all, and the reason is
  a hard CSS blocker rather than an oversight.** The strip is
  `overflow-x-auto`, and CSS forces `overflow-y` to a non-visible value
  whenever `overflow-x` is not visible — the computed pair measures
  `auto`/`auto`. A 44px `::after` on a 28px button inside a 36px strip is
  therefore generated at its full height and then CLIPPED to the strip, so it
  receives no tap the ink would not have received anyway: the utility emits and
  does nothing. It was applied, measured, and removed again. The only route to
  44px there is a taller strip, which reflows a floating toolbar whose reserved
  space (`RichEditor`'s `pb-24`) is asserted in `e2e/appearance.spec.ts` — J3's
  work. `TopControls` is the same shape WITHOUT the overflow and does carry it.

- **The row pin rests visible on touch AND long-press ships; neither replaces
  the other.** Sub-project I hid the resting pin because "the row menu is
  another route to pinning". On touch that route is a long press, which is
  invisible, so leaning on it alone would make the most common row action
  undiscoverable — and long-press is required regardless, because Duplicate,
  Copy text, Export and Delete have no other touch route. The accepted cost:
  the row's bottom-left 44px pins rather than selects. On a ~300×90 row that is
  a corner, and an unreachable pin is worse than a corner that pins.

- **The editor's context menu has NO touch route, deliberately, and the
  decision lapses if anything is added to it.** Every action it carries is
  reachable from `BottomToolbar`, and its table operations additionally from
  `TableHandleMenu`, whose handles rest visible under the rule above. So it is
  a second route to capabilities that already have one, not the pointer-only
  route to a real capability that `docs/rulings/accessibility.md` forbids. The
  OS keeps its own long-press callout — Cut, Copy, Look Up, Share — inside the
  `contenteditable`, which is what a phone user actually wants there. Add an
  action to `EditorContextMenu` with no `BottomToolbar` twin and this ruling is
  void.

- **A long press must swallow the synthetic mouse burst, with
  `stopImmediatePropagation` and only for touch.** Every mobile browser replays
  a touch as `mousedown`/`mouseup`/`click` so pointer-unaware pages keep
  working, and `useAnchoredMenu` dismisses on an outside `mousedown` in the
  CAPTURE phase — so the menu a press opened closed in the same frame and the
  gesture appeared to do nothing. The element's own `onClickCapture` cannot
  help, because a capture listener on `document` runs strictly before anything
  on the element; and `stopPropagation` cannot either, because it only stops
  OTHER NODES while both listeners sit on `document`. It must be gated on the
  pointer type: swallowing after a real right-click eats the user's click on
  the menu item they then choose.

## The editor on a phone (J3)

- **The keyboard is handled TWICE on purpose, and arithmetic — not feature
  detection — is what stops the two double-applying.** `index.html` asks for
  `interactive-widget=resizes-content`; where a browser honours it, the LAYOUT
  viewport shrinks too, so `window.innerHeight` and `visualViewport` agree,
  `keyboardInset()` returns 0, and the JavaScript fallback has nothing left to
  correct. Do not add a support check: there is no reliable way to detect this,
  and the arithmetic already covers it.

- **`window.innerHeight` is the wrong number for anything that must stay on
  screen.** It is the LAYOUT viewport, and on iOS a virtual keyboard does not
  change it — it shrinks `visualViewport.height` instead. Reading `innerHeight`
  means the app believes it has a full screen while a third of it is covered.
  `src/lib/visibleViewport.ts` is the single source of truth; `useAnchoredMenu`
  goes through it too, because it was deciding a menu "fits below" into space
  the user cannot see.

- **`offsetTop` is part of the answer, and `scroll` is part of the signal.** The
  visual viewport can be SCROLLED within the layout viewport — which is what iOS
  does to keep a focused field above the keyboard — so its bottom edge in client
  coordinates is `offsetTop + height`, and it emits `scroll` with no size change
  at all. A hook listening only to `resize` leaves the toolbar behind on exactly
  that motion, and every other assertion about it still passes.

- **`100dvh`, never `100vh`, for anything clamped to the screen.** `100vh` on
  mobile is the LARGE viewport and ignores the browser's collapsing chrome, so a
  menu clamped against it can still run past the bottom edge.

- **Three plausible ways to floor a table column's width do NOTHING, and the
  failures are silent and identical to no rule at all.** `min-width` on
  `td`/`th` is ignored under `table-layout: fixed`; `min-width` on the table
  loses to `@tiptap/extension-table`'s own inline `min-width: 50px`;
  `min-width` on `col` loses to its inline `min-width: 25px`. Only
  `.ProseMirror colgroup col { min-width: … !important }` works. That
  `!important` is not a shortcut past specificity we control — it is the only
  way to outrank a third-party INLINE style, which is the case the keyword
  exists for. Measure any change here; this is not a domain that rewards
  reasoning.

- **The table floor is safe only while column resizing is off.**
  `MarkdownTable` does not configure `resizable` and
  `@tiptap/extension-table` defaults it off, so no user-authored column width
  exists for the `!important` to overrule. Enable resizing and this becomes a
  floor a user cannot drag below.

- **Equal columns are kept deliberately.** `table-layout: auto` with a cell
  minimum also scrolls — measured at 562px against the colgroup route's 522 —
  but sizes columns to their content, which would change how every existing
  table looks on a desktop for no benefit to the defect being fixed.

- **The table handle layer is a SIBLING of the scroll container, not a child**
  (verified in the DOM: `wrapper.contains(layer) === false`; it is also why the
  reveal rule reads `:has(+ .tableWrapper:hover)`). So it neither moves with the
  cells nor is clipped by the wrapper. Row handles therefore pin to the VISIBLE
  left edge rather than the table's — tracking the table would walk them left
  across the prose — and column handles hide with `visibility`, not `display`,
  so a keyboard user's focus is not thrown out of the layer by a scroll.

- **The toolbar grows its INK on a coarse pointer, which is the one place J2's
  "expand the hit area, never the ink" rule is deliberately superseded.** It has
  to be: `overflow-x-auto` forces a non-visible `overflow-y`, so a 44px
  pseudo-element is generated and then clipped to the strip. J2 applied that
  utility, measured it, and removed it again. Growing is a reflow, and reflow was
  always J3's.

- **The toolbar's reserve did NOT need to grow, and the line that grew it was
  removed.** The taller strip reaches 68px into the pane against `pb-24`'s 96.
  A `coarse:pb-32` was written first and nothing could be made to fail with it
  absent; the guard in `e2e/phoneEditor.spec.ts` was itself verified by
  overgrowing the strip to `h-32`, where it fails at 96 < 140. A line no test
  can falsify is a line that will be wrong later without anyone knowing.

- **The scroll fade's opaque stops are `currentColor`, and that is not
  arbitrary.** A `mask-image` reads only the ALPHA channel, so the colour cannot
  matter as long as it is opaque — and `scripts/sourceLint.test.ts` forbids a
  colour literal outside `tokens.css`, correctly, because it cannot tell a
  mask's alpha carrier from a real colour and should not have to. A gradient
  OVERLAY was rejected instead: it would have to be painted in the strip's own
  background colour, and this app has sixteen themes.

## The boot indicator

- **`#root` must never be empty while the app is opening.** Until 2026-08-27 it
  was: `main.tsx` calls `createRoot` only after `openDatabase()` resolves, so
  every launch showed a blank page with no way to tell "still opening" from
  "broken". That is not hypothetical — the Dexie-version-blocked failure
  recorded in CLAUDE.md leaves `openDatabase()` permanently unsettled, and a
  bare `<div id="root">` plus one console warning was its entire symptom.

- **It fades in after a delay rather than appearing at once.** IndexedDB is
  local and the normal open is far faster than the delay, so a normal launch
  shows nothing at all. A spinner that flashes for 40ms is worse than no
  spinner.

- **Its colour is `var(--bear-muted, CanvasText)` — a token with a SYSTEM
  colour fallback, never a literal.** The production build links the stylesheet
  in `<head>` above the indicator and the inline theme script has already set
  `data-theme`, so the token resolves to the active theme's value and the
  spinner is themed on the first frame. `CanvasText` covers the dev server,
  where the stylesheet arrives with the module. A hex fallback here would be a
  defect under the every-colour-is-a-token rule.

- **`main.tsx` removes it BEFORE `createRoot`, not by letting React clear the
  container.** React does empty the container, but only after the root is
  created and `render` is called; until then the indicator is a real element
  with a running animation.

- **It is `aria-hidden`.** It carries no text, it is decorative, and the app it
  stands in for replaces it within a frame of being able to. There is no
  translated string to give it — it exists before React and therefore before
  `useT`.

## The section drop indicator (B2)

- **The indicator is a RULE across the measure, never a gap that opens up.**
  `.bear-section-drop` in `src/styles/editor.css` is a 2px bar, not a spacer
  that grows the document to make room for it. A gap-that-opens would reflow
  the note under a live drag, and that reflow would move the very drop
  boundaries the pointer is being compared against — `measureBoundaries` in
  `HeadingFold.ts` measures every boundary's position ONCE, at drag start, in
  the scroller's document coordinates, and never re-measures mid-drag. An
  indicator that changed layout would therefore invalidate its own
  measurement on every frame it was visible. This is the same reason a
  document change mid-drag abandons the drag outright rather than trying to
  map `dropAt` forward — see `HeadingFold.ts`'s `apply`, the `tr.docChanged &&
  value.dragFrom !== null` branch.

## Callout colour and icons (M9b)

- **Five hues, TWO roles each, and one role is not enough.** The `fill` is a
  panel that `--bear-text` must read through; the `edge` — the left bar and
  the icon — is an opaque mark that must be legible on its own. They are
  checked separately: fills at 4.5 in `OVERLAYS`, edges at 3.0 in
  `DECORATIVE`.

- **The fill MIXES INTO `--bear-bg`; it is not alpha laid over it.** That is
  the difference between a tint that works in sixteen themes and one that
  works in eight. An alpha tint of a LIGHT hue over a DARK ground raises the
  panel's luminance sharply, and the light body text then loses the contrast
  the panel exists to preserve. Mixing into the theme's own background keeps
  the panel within a few percent of it by construction, in either scheme.

- **The edge is a light/dark literal pair interpolated on `--bear-dark`**, the
  mechanism the syntax palette proves. A single fixed hue — the way
  `--bear-hl-*` works — cannot serve both schemes for an opaque mark.

- **The hues stay independent of `--bear-accent`, `--bear-danger` AND
  `--bear-code-*`.** The literals come from the same measured families as the
  syntax palette but are DUPLICATED rather than aliased: a theme that retunes
  its code colours must not repaint the user's prose. Reusing `--bear-danger`
  for the danger callout was considered and rejected on the same grounds.

- **Five contrast rows exist purely to stop the other five being vacuous.** A
  fill identical to `--bear-bg` passes a 4.5 check against `text` perfectly,
  so a callout that had silently stopped tinting anything would sail through.
  `CALLOUT_FILLS_ARE_VISIBLE` requires the panel to be visible AS a panel.
  Both directions are fault-injected: the fill rows fail across all 16 themes
  before the tokens exist, and a zero mix fails all 16 after.

- **`e2e/callouts.spec.ts` checks the five fills are distinct FROM EACH
  OTHER.** Nothing else can: the contrast spec checks each fill against the
  page in isolation, so two types resolving to the same colour — what a
  copy-paste slip in `tokens.css` produces — passes every ratio while making a
  warning indistinguishable from a danger.

- **The icons are TOKENS (`--bear-cal-icon-*`), not a mirrored stylesheet
  block.** `readExportTokens` copies custom properties verbatim (reading one
  back does not resolve it), so the exported document draws its glyphs from
  the same declaration the editor uses. One source, no drift, and no mirror
  test to write — which is a better answer than the plan's, and the plan was
  wrong.

- **Drawn with `mask-image` over `background: currentColor`.** One glyph
  serves every theme and takes the type's edge hue from the cascade. This is
  also why `lucide-react`'s ban outside `Icon.tsx` — measured at +57.20 kB
  gzip — does not apply here: nothing reaches JavaScript.

- **A missing icon falls back to `none`, never to a placeholder shape.** A
  mask that fails to load paints the whole ELEMENT, so a fallback glyph would
  draw a solid square where the icon should be. `none` collapses to nothing
  and the header keeps its words.

- **The title text is `--bear-text`, not the edge hue.** Colouring it would
  need the edge to clear 4.5 on the fill rather than 3.0 on the page, which no
  palette this readable would survive — and the bar plus the icon already
  carry the type, which is also what keeps colour from being its only carrier.

- **The empty-header hint is a DECORATION and cannot become content.**
  `calloutTitle` does not know its parent's type and CSS `attr()` cannot reach
  an ancestor's attribute, so the plugin sets `data-placeholder` in the view.
  It registers no plugin at all without `calloutLabels`, which is every schema
  build outside the mounted editor — so the hint can never reach a note's text
  or an exported file. Baking the name into the Markdown (note text would
  depend on the UI language at the last save) and a per-locale CSS `content:`
  string (Korean outside `useT`, where `ko.ts`'s completeness check cannot see
  it) were both rejected.

## Scrollbars

- **Every theme block declares `color-scheme` next to `--bear-dark`, and
  `scripts/sourceLint.test.ts` asserts the two agree.** It cannot be derived
  from the number, and no test could see the omission: with no `color-scheme`
  at all the browser paints its native chrome in LIGHT mode on every theme, so
  the dark themes shipped a white scrollbar down the side of the sidebar from
  M0 to here. `color-scheme` also governs form controls and the `:focus-ring`
  default, so this is not scrollbar-only cosmetics.

- **The scrollbar is a tint of `--bear-text` over a TRANSPARENT track, never a
  colour of its own.** The three scrollers sit on three different backgrounds
  (`--bear-sidebar`, `--bear-surface`, `--bear-bg`); one opaque token would be
  wrong on at least two of them. `--bear-scroll-a` interpolates on
  `--bear-dark` the way `--bear-hover-a` does, and `high-contrast` overrides it
  to 0.6 for the same reason its overlays are solid — that is the one theme
  where blending into the background is the wrong goal.

- **The standard properties and `::-webkit-scrollbar` are split by
  `@supports`, not written side by side.** They are not additive: Blink
  honours `scrollbar-width`/`scrollbar-color` and then IGNORES every
  `::-webkit-scrollbar` rule on the same element, so a hover state written in
  the WebKit syntax next to them would silently never apply. Firefox takes the
  standard pair (which has no hover state); Blink and WebKit take the
  pseudo-elements, which do.

- **A custom scrollbar is never an OVERLAY one.** On a Mac set to "show
  scrollbars only when scrolling" the thumb is now always drawn and takes 8px.
  That is the accepted cost of a scrollbar that matches the theme on every
  platform, and it is why the thumb alpha is low enough to read as a hairline
  rather than a bar.


- **Five type tokens are user-controlled since Q, and may not be
  re-hardcoded.** `--bear-font-size`, `--bear-line-height`,
  `--bear-line-width`, `--bear-para-spacing` and `--bear-para-indent` are
  written onto `documentElement` by `src/app/typography.ts`'s
  `applyTypography` and by `index.html`'s pre-paint script. A new consumer
  reads the token; a literal in its place silently ignores the reader's
  preference, and nothing fails.

- **`DEFAULTS` in `typography.ts` must stay equal to the values `tokens.css`
  declares.** That equality is what makes `npm run measure:check` a regression
  test for this feature: Q's defaults are today's geometry, so no measured
  surface may move, and a diff in `measurements.md` means the preference has
  leaked out of the prose and into the app chrome. Changing a default without
  changing the token (or the reverse) turns a live gate into a stale one.
  `typography.test.ts` asserts the five values literally, at the point where
  someone would make the change.

- **The bounds are duplicated in `index.html` on purpose**, because the
  pre-paint script cannot import a module without becoming async and losing
  the only thing it exists for. `scripts/sourceLint.test.ts` asserts the two
  lists agree, along with the property names and the storage key. Drift is
  silent, and worst when the script's bounds are WIDER than the model's: a
  hand-edited mirror then paints a first frame the app immediately corrects,
  which reads as a flash with no cause.

- **`--bear-line-width` cannot widen the prose past the pane, and on a laptop
  it usually cannot widen it at all.** `editor.css`'s rule is
  `max-width: min(var(--bear-line-width), 100% - 3rem)`. Measured at a 1280
  viewport with three panes open: the editor pane is 656px, so the prose is
  capped at 608px while the 40em default already computes to 640px — dragging
  the control rightward changes nothing, and only the downward half of its
  range does anything. At 1800 both directions work (840px → 1128px). This is
  the clamp behaving correctly, not a defect, and it is recorded so nobody
  "fixes" the control: the honest reading is that at narrow widths "cramped"
  is a PANE problem, not a measure problem.

- **In the theme picker, the FRAME comes from the app's palette and only the
  PREVIEW carries `data-theme`.** Never move the attribute back onto the radio.
  When the card was one element carrying `data-theme`, its background and its
  border, the line separating it from the dialog panel resolved in the card's
  theme while the panel resolved in the app's, and nothing made them contrast:
  across all 240 (app theme × card theme) pairs, 52 had the card's fill within
  1.10 of the panel, 34 had its border within 1.20, and **4 had both** —
  `solarized-light`/`paper`, `rose-dawn`/`paper`, `sepia`/`solarized-light`,
  `sepia`/`rose-dawn`. A user reported the first of those.

- **Pinning the picker's panel to a fixed theme cannot fix that, and the reason
  is structural rather than aesthetic.** The roster spans `paper` (pure white)
  to `high-contrast` (pure black), so no single panel colour contrasts with
  every card; whatever the panel is pinned to, some card vanishes into it. Only
  a per-card frame outside the `data-theme` boundary works. Pinning would also
  stop the dialog showing the theme it just applied.

- **That frame is `--bear-faint`, not `--bear-border`, and the difference is
  measured.** Against each theme's own background, `--bear-border` runs
  1.27–1.31 and `--bear-faint` runs 3.33–3.86. A hairline would have lifted the
  worst case only from 1.18 to about 1.27, which is why the obvious fix was
  rejected. Weakening it back to `--bear-border` fails 15 of the 16 gate tests;
  only `high-contrast` survives, where the hairline happens to be 21:1.

- **The frame is a real 1px border in BOTH states, never a ring in one and a
  border in the other.** Selecting a card must not shift the grid by a pixel,
  and `e2e/contrast.spec.ts` reads the frame colour straight off `borderColor`
  rather than parsing it out of a box-shadow.

- **The language preference is read SYNCHRONOUSLY, during `I18nProvider`'s
  first render.** `src/i18n/localeMirror.ts` exists for that and nothing else,
  which is also why it lives in `src/i18n/` rather than beside the theme's
  mirror in `src/app/`: the provider needs it before any effect runs, and
  importing from `src/app/` would drag the application layer into every test
  that renders a translated component. Moving the read into an effect fails
  `e2e/locale.spec.ts`'s no-flash test AND a unit test — measured, by doing it.

- **`readLocaleMirror` returns `null` for absence, never a default.** "Nothing
  stored" and "the reader chose English" are different states: the first must
  fall through to `detectLocale`, and a default of `'en'` here would silently
  override language detection for every new visitor, which is the one thing it
  must not do.

- **`locale.switch` is ONE key meaning "switch to the other language", so the
  active bundle supplies the direction** — English reads "Switch to Korean",
  Korean reads the reverse. Two keys would let the bundles drift into
  disagreeing about which way the button goes, and no test would catch it. The
  key predated its first consumer and read "Language"; it was never rendered,
  so it was repointed rather than duplicated.
