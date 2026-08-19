---
version: alpha
name: bear-web Design Language
description: A quiet, warm-greyscale design system for a local-first Markdown notes app — one accent red, type-led hierarchy, no drop shadows beyond two floating surfaces, motion expressed as tokens rather than per-component durations.

colors:
  bg: "#ffffff"
  surface: "#faf9f8"
  sidebar: "#f1efec"
  text: "#1c1b19"
  muted: "#6b6862"
  faint: "#88857d"
  border: "#e5e2dd"
  accent: "#cf3b2c"
  danger: "#cf3b2c"
  focus: "#cf3b2c"
  hover: "rgb(28 27 25 / 0.05)"
  selected: "rgb(207 59 44 / 0.11)"
  shadow: "rgb(28 27 25 / 0.14)"

typography:
  ui-xs:
    fontFamily: Pretendard Variable
    fontSize: 11px
    lineHeight: 1.4
    use: counts, badges
  ui-sm:
    fontFamily: Pretendard Variable
    fontSize: 12px
    lineHeight: 1.45
    use: timestamps, snippets
  ui:
    fontFamily: Pretendard Variable
    fontSize: 13px
    lineHeight: 1.45
    use: rows, buttons — the workhorse size
  ui-md:
    fontFamily: Pretendard Variable
    fontSize: 14px
    lineHeight: 1.4
    use: note titles
  ui-lg:
    fontFamily: Pretendard Variable
    fontSize: 16px
    lineHeight: 1.35
    use: pane headers, empty states
  mono:
    fontFamily: JetBrains Mono Variable
    use: code spans and blocks inside notes

rounded:
  sm: 4px
  md: 6px
  lg: 10px

spacing:
  note: "There is no spacing token scale. Layout uses Tailwind's default 4px-grid utilities (p-2, gap-1, px-3, ...) directly. See Layout below for why."

motion:
  duration-fast: 100ms
  duration: 160ms
  ease: "cubic-bezier(0.2, 0, 0.2, 1)"

shadows:
  popover: "0 4px 12px {colors.shadow}"
  dialog: "0 12px 32px {colors.shadow}"

components:
  sidebar-row:
    height: 28px
    typography: "{typography.ui}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    selectedBackground: "{colors.selected}"
    selectedIndicator: "{colors.accent}"
    hoverBackground: "{colors.hover}"
    countColor: "{colors.faint}"
    countTypography: "{typography.ui-xs}"
  note-list-row:
    padding: "0.625rem 0.75rem"
    borderColor: "{colors.border}"
    titleColor: "{colors.text}"
    titleTypography: "{typography.ui-md}"
    dateColor: "{colors.faint}"
    dateTypography: "{typography.ui-sm}"
    snippetColor: "{colors.muted}"
    snippetTypography: "{typography.ui-sm}"
    selectedBackground: "{colors.selected}"
    selectedIndicator: "{colors.accent}"
    hoverBackground: "{colors.hover}"
  toolbar:
    height: 36px
    borderColor: "{colors.border}"
    background: "{colors.bg}"
    role: toolbar
  toolbar-button:
    height: 28px
    padding: "0 0.5rem"
    rounded: "{rounded.sm}"
    textColor: "{colors.muted}"
    hoverBackground: "{colors.hover}"
    activeBackground: "{colors.selected}"
    activeTextColor: "{colors.text}"
    disabledOpacity: 0.4
  button-default:
    height: 28px
    padding: "0 0.5rem"
    rounded: "{rounded.sm}"
    textColor: "{colors.text}"
    hoverBackground: "{colors.hover}"
    typography: "{typography.ui}"
  button-primary:
    height: 28px
    padding: "0 0.5rem"
    rounded: "{rounded.sm}"
    background: "{colors.accent}"
    textColor: "{colors.bg}"
    hoverOpacity: 0.9
    typography: "{typography.ui}"
  button-danger:
    height: 28px
    padding: "0 0.5rem"
    rounded: "{rounded.sm}"
    background: "{colors.danger}"
    textColor: "{colors.bg}"
    hoverOpacity: 0.9
    typography: "{typography.ui}"
  button-ghost:
    height: 28px
    padding: "0 0.5rem"
    rounded: "{rounded.sm}"
    textColor: "{colors.muted}"
    hoverBackground: "{colors.hover}"
    hoverTextColor: "{colors.text}"
    typography: "{typography.ui}"
  empty-state:
    layout: centered column, full pane height
    titleColor: "{colors.text}"
    titleTypography: "{typography.ui-lg}"
    bodyColor: "{colors.muted}"
    bodyTypography: "{typography.ui}"
    maxWidth: 20rem
  dialog:
    description: "Not yet built — M6 spec. A modal confirmation surface (e.g. Empty Trash, permanent delete) sitting above the app on a scrim."
    background: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    shadow: "{shadows.dialog}"
    scrimBackground: "rgb(28 27 25 / 0.3) in Paper, rgb(0 0 0 / 0.5) in Ink — not yet a token; derive from {colors.shadow}'s tint at authoring time"
    titleTypography: "{typography.ui-lg}"
    bodyTypography: "{typography.ui}"
    actionsAlignment: "trailing, button-default and button-danger/button-primary pair"
    focusTrap: required
    dismissal: "Escape key and scrim click, both must return focus to the element that opened the dialog"
---

## Overview

bear-web is quiet on purpose. There is exactly one hue in the entire palette —
a warm brick red — and it is spent carefully: selection, the accent edge on
the active row, primary and danger actions, and the focus ring. Everything
else is a warm greyscale, built from four surface steps (`{colors.bg}`,
`{colors.surface}`, `{colors.sidebar}`, and translucent `{colors.hover}` /
`{colors.selected}` overlays) and three text steps (`{colors.text}`,
`{colors.muted}`, `{colors.faint}`). The app is modeled on Bear for macOS, and
it reads like a macOS utility, not a marketing site: no gradients, no
saturated chrome, no drop shadow except on the two surfaces that actually
float above the page. Hierarchy is carried by type size and color weight, not
by decoration — a sidebar row, a note-list row, and a toolbar button are all
built from the same handful of tokens at different sizes.

**Key characteristics:**

- Warm, near-neutral greyscale (a slightly yellow-grey, not a cool blue-grey)
  across four surface steps, in both a light theme (Paper) and a dark theme
  (Ink).
- One accent hue, `{colors.accent}` — a brick/coral red depending on theme —
  that also backs `{colors.danger}` and `{colors.focus}`. The three tokens are
  separate names resolving to one colour today so a future theme can diverge
  them without a rename.
- UI type is one notch below the web default: 13px is the workhorse row/button
  size, echoing a macOS app's chrome being set smaller than its content.
  Editor type is a separate, larger scale and is not covered by this document
  — see Typography below.
- Selection reads as *more present* than its surroundings: an accent-tinted
  translucent fill plus a 2px accent edge marker, never a plain background
  swap.
- Two duration tokens, one easing curve, no per-component transition timing.
- Two shadow tokens total, for the two floating surfaces the app has
  (popovers and, from M6, dialogs). Everything else is flat, separated by
  colour field and a 1px hairline border.

## Colors

### Surface

| Token             | Paper     | Ink       | Use                                            |
| ------------------ | --------- | --------- | ----------------------------------------------- |
| `{colors.bg}`      | `#ffffff` | `#1a1a19` | Page canvas, editor background                  |
| `{colors.surface}` | `#faf9f8` | `#201f1e` | Note list background, one step off the canvas   |
| `{colors.sidebar}` | `#f1efec` | `#262523` | Tag sidebar background, the most-recessed panel |
| `{colors.border}`  | `#e5e2dd` | `#35332f` | Hairline dividers between panes and list rows   |

### Text

| Token            | Paper     | Ink       | Use                                          |
| ----------------- | --------- | --------- | --------------------------------------------- |
| `{colors.text}`  | `#1c1b19` | `#ebe9e5` | Primary reading text, note titles, headings  |
| `{colors.muted}` | `#6b6862` | `#a09c94` | Secondary text — snippets, body copy in lists |
| `{colors.faint}` | `#88857d` | `#7b766e` | Supplementary text — timestamps, counts       |

### Accent

| Token              | Paper     | Ink       | Use                                            |
| ------------------- | --------- | --------- | ------------------------------------------------ |
| `{colors.accent}`  | `#cf3b2c` | `#ff6f5e` | Selection edge, primary buttons, active states |
| `{colors.danger}`  | `#cf3b2c` | `#ff6f5e` | Destructive actions (trash, permanent delete)  |
| `{colors.focus}`   | `#cf3b2c` | `#ff6f5e` | The one global `:focus-visible` ring             |

`accent`, `danger`, and `focus` resolve to the same value in both shipped
themes. They are not aliases of one token — they are three tokens that happen
to agree today. An M8 theme with a green accent must not turn the Delete
Forever button green; keeping the names separate is what makes that possible
without touching every call site.

### Overlay

| Token               | Paper                     | Ink                        | Use                                    |
| -------------------- | -------------------------- | --------------------------- | ---------------------------------------- |
| `{colors.hover}`    | `rgb(28 27 25 / 0.05)`    | `rgb(255 255 255 / 0.06)` | Hover fill, any row or button           |
| `{colors.selected}` | `rgb(207 59 44 / 0.11)`   | `rgb(255 111 94 / 0.18)` | Selected row/note fill — accent-tinted   |
| `{colors.shadow}`   | `rgb(28 27 25 / 0.14)`    | `rgb(0 0 0 / 0.5)`        | Base for the two shadow tokens          |

These three are translucent, not solid fills, because each sits over three
different backgrounds (sidebar, note list, editor canvas) and no single solid
colour could serve all three. `selected` is accent-tinted rather than a
neutral grey — that tint is what makes a selected row read as *more* present
than an unselected one. Before this milestone, selection was `{colors.bg}`
under the row: literally less contrast than the surrounding list, a hole
rather than a highlight.

### Measured contrast ratios

Computed by hand with a real WCAG 2.1 relative-luminance calculation
(sRGB channel linearisation, `(L1 + 0.05) / (L2 + 0.05)`), because the
alpha-composited overlays across three surfaces in two themes cannot be
computed by jsdom in the test suite. Script: throwaway Node script, not
checked in.

| Foreground | Background | Target | Paper      | Ink        |
| ----------- | ----------- | ------ | ---------- | ---------- |
| `text`     | `bg`       | ≥ 7.0  | **17.21:1** | **14.36:1** |
| `text`     | `sidebar`  | ≥ 7.0  | **15.00:1** | **12.63:1** |
| `muted`    | `surface`  | ≥ 4.5  | **5.28:1**  | **6.02:1**  |
| `faint`    | `sidebar`  | ≥ 3.0  | **3.21:1**  | **3.40:1**  |
| `bg`       | `accent`   | ≥ 4.5  | **4.87:1**  | **6.38:1**  |
| `accent`   | `sidebar`  | ≥ 3.0  | **4.24:1**  | **5.61:1**  |
| `text`     | `surface`  | ≥ 7.0  | **16.37:1** | **13.57:1** |
| `faint`    | `bg`       | ≥ 3.0  | **3.69:1**  | **3.86:1**  |
| `faint`    | `surface`  | ≥ 3.0  | **3.50:1**  | **3.65:1**  |

Every pair passes its target, with margin.

### M7.5: contrast against the canvas

M7.5 introduced `{colors.canvas}` — `#e8e4de` in Paper, `#121211` in Ink — as
the ground the three panes float on, painted on `body` behind the panes' own
rounded, shadowed cards. Panes carry no border: `src/ui/Pane.tsx` separates a
pane from the canvas with `rounded-lg shadow-popover` alone, computed
`borderTopWidth` is `0px` on all three panes in both themes, and the spec's
own words are "Cards carry depth, not borders." An earlier draft of this
section measured a `border`-on-`canvas` ratio and justified the low
canvas/pane ratios below by "the 1px `border` hairline around each pane" —
that row and that reasoning described a hairline that does not exist in the
shipped build and has been removed. What actually separates a pane from the
canvas is `{shadows.popover}` and the background step between `{colors.canvas}`
and the pane's own fill, both measured below.

Canvas is one step darker than every pane background in both themes, so it
was measured against each; for completeness, `text`/`faint` above were also
re-run against every pane background rather than just `sidebar`, since M7.5
changed nothing about `bg` or `surface` but the sidebar row alone was
previously the only one checked for `faint`.

The canvas itself, read against each pane background (not a WCAG requirement —
this is the number that decides whether the panes read as cards floating
above a ground at all, not a text-legibility check):

| Background pair       | Target | Paper      | Ink        |
| ----------------------- | ------ | ---------- | ---------- |
| `canvas` vs `sidebar`  | n/a    | **1.10:1** | **1.22:1** |
| `canvas` vs `surface`  | n/a    | **1.20:1** | **1.14:1** |
| `canvas` vs `bg`       | n/a    | **1.27:1** | **1.08:1** |

These ratios are low by design — the canvas is a subtle, warm-greyscale step,
not a strong colour break — and the separation a user actually sees comes
from the combination of this small colour step and `{shadows.popover}`, not
from any border: the panes have none. Judged acceptable: none of the three
panes' `text` or `faint` ratios above regressed when the canvas shipped,
which is the property that actually matters (a user must still be able to
read the app); the panes-as-cards effect is a design choice measured here for
the record, not a bar to clear.

No token changed as a result of this measurement — every text/faint pair
against the new canvas era's pane backgrounds already cleared its bar with
margin, so `--bear-faint` was not touched.

**`faint` was deliberately darkened during this milestone to clear this
bar**, in both themes: Paper's `--bear-faint` moved `#9c988f` → `#88857d`
(2.51:1 on `sidebar` → 3.21:1) and Ink's moved `#746f68` → `#7b766e` (3.07:1 →
3.40:1) — Ink's original number technically passed but with no real margin,
which is not acceptable for a value that has to hold across three
backgrounds. **Do not lighten `faint` back toward its original value for
aesthetic reasons** without re-running this contrast check; a future
contributor doing so would silently reopen this gap. Both changes preserve
the `text > muted > faint` reading order — `faint` is still visibly the
lightest/dimmest of the three in each theme.

## Typography

### Font families

- **Pretendard Variable** — the UI sans, used for every pane, row, button, and
  label in the app shell. Loaded as a variable font via
  `pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css`.
- **JetBrains Mono Variable** — the monospace face, used for code spans and
  fenced code blocks inside note content.

### UI scale

UI type is deliberately one notch below the browser default — 13px is the
workhorse size, where a web app would default to 14–16px. This echoes a
macOS-native app setting its chrome smaller than its content; before this
milestone the whole app ran at a flat 14px.

| Token             | Size    | Line height | Use                          |
| ------------------- | ------- | ------------ | ------------------------------ |
| `{typography.ui-xs}` | 11px    | 1.4          | Counts, badges                |
| `{typography.ui-sm}` | 12px    | 1.45         | Timestamps, snippets           |
| `{typography.ui}`    | 13px    | 1.45         | Rows, buttons — the workhorse |
| `{typography.ui-md}` | 14px    | 1.4          | Note titles                    |
| `{typography.ui-lg}` | 16px    | 1.35         | Pane headers, empty states     |

### Editor typography is separate, and owned by M8

The editor's own type — `--bear-font-size` (16px), `--bear-line-height`
(1.6), `--bear-line-width` (40em), `--bear-para-spacing`, `--bear-para-indent`
— is a distinct scale bound to M8's preference sliders (font size, line
height, and measure will all become user-adjustable). Do not reuse the UI
scale for note content, and do not treat the editor tokens as part of this
document's scope: they are read but not designed here.

## Layout

### Why there are no spacing tokens

There is deliberately no `spacing` scale in this system. Tailwind's default
spacing scale is already a 4px grid (`p-1` = 4px, `p-2` = 8px, `p-3` = 12px,
...), and it is used directly throughout the app (`px-3 py-2.5`, `gap-1`,
`h-7`, `h-9`). A second, bear-web-specific spacing scale on top of Tailwind's
would create a standing question at every call site — "reach for the design
token or the Tailwind utility?" — for no benefit, since they'd resolve to the
same pixel grid anyway. Radii and durations get tokens because their values
are opinionated and small in number; spacing does not need the same
treatment.

### Density rules

| Element             | Height / measure | Notes                                              |
| --------------------- | ------------------ | ----------------------------------------------------- |
| Sidebar row          | 24px (`h-6`)      | Each nesting depth indents 0.75rem. 24 not Bear's 22, to stay on the 4px grid |
| Note list row        | 88px, `py-2`      | Title / date / two-line snippet, `gap-0.5`; the second snippet line is reserved, not collapsible |
| Toolbar (top/bottom) | 36px (`h-9`)      | Bottom toolbar is a horizontally scrolling button row |
| Button, `sm`         | 24px (`h-6`)      |                                                        |
| Button, `md`         | 28px (`h-7`)      | The default size                                      |
| Editor measure       | `40em` (`--bear-line-width`) | Bear's rendered 643pt at 16pt. M8-adjustable |

### Panes

Three panes — tag sidebar, note list, editor — each an `overflow-y-auto`
`<section aria-label>` (`src/ui/Pane.tsx`). Sidebar and note-list widths are
durable, persisted via the settings table, not component state; the editor
pane fills the remainder. A `Resizer` (`src/ui/Resizer.tsx`) sits between
panes: an 8px interactive hit-target collapsed visually to a 1px hairline
that thickens and tints `{colors.accent}` on hover/focus.

## Motion

Two duration tokens and one easing curve, used everywhere:

- `--bear-duration-fast` (100ms) — hover/press state changes on rows and
  buttons.
- `--bear-duration` (160ms) — reserved for slower transitions (panel
  open/close, dialog entry from M6 onward).
- `--bear-ease` — `cubic-bezier(0.2, 0, 0.2, 1)`, applied via the `ease-bear`
  Tailwind utility.

`prefers-reduced-motion: reduce` zeroes both duration tokens in one media
query block. This is the entire reason no component may hardcode a duration:
a per-component `transition-duration: 150ms` would keep animating under
reduced motion, silently defeating the accessibility preference for exactly
the component that skipped the token.

## Shapes

| Token            | Value | Use                                          |
| ------------------ | ----- | ----------------------------------------------- |
| `{rounded.sm}`   | 4px   | Rows, buttons, toolbar buttons — everyday chrome |
| `{rounded.md}`   | 6px   | Reserved, not yet in use by a shipped component |
| `{rounded.lg}`   | 10px  | Popovers, and (from M6) dialogs                 |

Geometry is restrained: nothing rounds past 10px, there are no pill shapes,
and no component is fully circular. This is the inverse of a marketing site's
soft, toy-like geometry — bear-web reads as utilitarian chrome around type,
not as a shape to look at.

## Components

### `sidebar-row`

One row of the tag tree (`src/ui/SidebarRow.tsx`). 28px tall, `{typography.ui}`,
optional disclosure triangle, optional leading icon, optional trailing count.
Selected state: `{colors.selected}` fill plus a 2px accent bar on the leading
edge (`bg-accent`), not a plain background swap. A leaf row without a
disclosure control still reserves the disclosure's width with an
`aria-hidden` spacer, so every row's label lines up regardless of depth.
**The gap between label and count is bridged by an explicit space text node,
not `gap-2`** — screen-reader accessible-name computation concatenates text
content and ignores CSS gaps; without the literal space, a row with a count
of 3 announces as "work3" instead of "work 3". This app shipped that
regression once already.

### `note-list-row`

One row of the note list (`src/features/notes/NoteListItem.tsx`). Title
(`{typography.ui-md}`, semibold, `{colors.text}`), date (`{typography.ui-sm}`,
`{colors.faint}`), and a text snippet (`{typography.ui-sm}`, `{colors.muted}`)
stacked with a hairline bottom border. Selected state mirrors `sidebar-row`:
`{colors.selected}` fill and a 2px accent bar on the leading edge.

### `toolbar`

Two toolbars exist: `TopControls` (per-note controls: info panel toggle) and
`BottomToolbar` (formatting actions: heading, lists, bold/italic/strike,
highlight, link, code, quote). Both are `role="toolbar"` with a translated
`aria-label`, 36px tall, a hairline border separating them from the editor
canvas, background `{colors.bg}`.

### `toolbar-button`

A single action inside a toolbar. 28px, `{colors.muted}` text at rest,
`{colors.hover}` background on hover, `{colors.selected}` background plus
`{colors.text}` text when `aria-pressed="true"` (an active format — e.g. bold
is on at the caret). Disabled (no editor mounted) drops to 40% opacity and
disables pointer events; it does not change colour, only opacity, so the
disabled state reads as *the same button, unavailable* rather than a
different control.

### `button-default`

`{colors.text}` on transparent, `{colors.hover}` on hover. The unmarked,
lowest-emphasis action.

### `button-primary`

`{colors.accent}` fill, `{colors.bg}` text, 90% opacity on hover. `text-bg` is
the on-accent foreground in *both* themes, not a coincidence worth losing:
Paper's `bg` is white against a mid red and Ink's `bg` is near-black against a
light coral — a literal white would fail contrast in Ink.

### `button-danger`

Same shape as `button-primary`, filled with `{colors.danger}` instead. Reach
for this — never `button-primary` tinted red by hand, and never `{colors.accent}`
where the intent is destructive — even though the two tokens resolve to the
same hex today.

### `button-ghost`

`{colors.muted}` text, `{colors.hover}` background on hover, brightening to
`{colors.text}` on hover as well. The lowest-visual-weight variant, used
where a control needs to be discoverable but not compete with content.

### `empty-state`

Centered column filling the full pane height: a `{typography.ui-lg}` title in
`{colors.text}`, a `{typography.ui}` body in `{colors.muted}` capped at
`20rem` (`max-w-xs`) so prose doesn't stretch edge-to-edge in a wide pane.
Used for "no notes," "trash is empty," and (by extension) any future
zero-state.

### `dialog` — not yet built, this is the M6 spec

No modal exists in the shipped app yet; M6 owns trash management (Empty
Trash, permanent delete confirmation) and will need one. Specified here so
M6 has a target rather than a blank page:

- Surface: `{colors.surface}` fill, `{colors.border}` 1px edge,
  `{rounded.lg}` corners, `{shadows.dialog}` — the second of the app's exactly
  two floating-surface shadows (the first is `{shadows.popover}`).
- Scrim: a translucent full-viewport overlay behind the dialog. No token
  exists for it yet; derive it from `{colors.shadow}`'s tint rather than
  inventing an unrelated black.
- Title at `{typography.ui-lg}`, body at `{typography.ui}`, both on
  `{colors.text}` / `{colors.muted}` respectively, following the same
  hierarchy as `empty-state`.
- Actions right-aligned, typically a `button-default` (Cancel) paired with a
  `button-danger` (the destructive confirmation) or `button-primary`.
- Must trap focus while open and restore focus to the triggering element on
  both Escape and scrim-click dismissal — the same focus-return discipline
  the rest of the app's `:focus-visible` ring depends on.
- Entry/exit motion, if any, uses `{motion.duration}` and `{motion.ease}` —
  never a bespoke duration.

## Do's and Don'ts

### Do

- Reach for `{colors.accent}` for the one thing that should draw the eye on a
  screen: a selected row's edge, a primary button, the focus ring.
- Build every new row/button variant out of the existing `{colors.hover}` /
  `{colors.selected}` / `{colors.border}` trio rather than inventing a new
  overlay opacity.
- Keep UI type at `{typography.ui}` (13px) for rows and buttons; reserve
  `{typography.ui-md}` and `{typography.ui-lg}` for titles and headers only.
- Use the `{motion.duration-fast}` / `{motion.duration}` tokens (via the
  `ease-bear` utility) for every transition, so `prefers-reduced-motion`
  keeps covering the whole app.
- Add an explicit space text node (`{' '}`) wherever a `gap` utility visually
  separates two pieces of text that together form one accessible name.

### Don't

- Don't write a colour literal (`#...`, `rgb(...)`, `hsl(...)`) inside a
  component — `scripts/sourceLint.test.ts` scans every `.ts`/`.tsx` file and
  fails the build on one. Colour lives in `src/styles/tokens.css` only.
- Don't add a themed token to only one of the two dark blocks
  (`:root[data-theme='dark']` and the `@media (prefers-color-scheme: dark)`
  block). `scripts/sourceLint.test.ts` asserts the two blocks stay
  token-for-token identical; a token added to just one silently diverges
  system-preference dark mode from an explicit dark-mode choice.
- Don't simplify `:root:not([data-theme='light'])` — it looks removable
  today because no explicit picker exists yet, but it is the exact seam M8's
  theme picker will use to override the system default.
- Don't introduce a spacing token scale. Tailwind's default scale is already
  a 4px grid; a second one creates a standing "which do I reach for" question
  with no corresponding benefit.
- Don't reach for `{colors.accent}` where the intent is destructive — use
  `{colors.danger}`. They are the same hex in both shipped themes today, but
  are separate tokens precisely so an M8 theme can diverge them; code that
  conflates them breaks the moment one theme does.
- Don't write a per-component transition duration. Use `{motion.duration-fast}`
  / `{motion.duration}` so `prefers-reduced-motion` continues to cover every
  animation, including ones added after this document.
- Don't set `outline-none` without supplying a visible focus replacement.
  Exactly two files are allowlisted for it
  (`src/ui/Resizer.tsx` and `src/features/editor/RichEditor.tsx`, each with a
  documented replacement indicator) and `scripts/sourceLint.test.ts` fails
  the build on a third.
- Don't rely on a CSS `gap` to separate two text nodes that together form an
  accessible name. Accessible-name computation concatenates text content and
  ignores layout gaps; this milestone shipped, and then reverted, a
  regression where a sidebar row's label and count announced as "work3"
  instead of "work 3." Use an explicit space text node.

---

## Measured against the real Bear (2026-08-18)

The first quantitative comparison between this app and its reference. Bear's
numbers come from pixel measurement of five full-resolution screen captures of
Bear 2 on macOS; ours come from `npm run measure`, which drives a real Chromium
at 1440x900 and writes `docs/design/measurements.md`. Regenerate our column any
time; Bear's column only changes if new captures are measured.

### Calibration, and why these numbers are trustworthy

The captures are 2000x1125 with a menu bar exactly 24px tall. The macOS menu bar
is 24pt, so the capture is **1 px per point** and every figure below is in
points, directly comparable to our CSS pixels. Two independent checks agree:
Bear's body line pitch measures 25pt, and Bear's own typography panel reports
16pt at line-height 1.6 (= 25.6pt); and Bear's surface colours match the
Catppuccin Latte palette value-for-value.

### The captures are themed, so their colours are NOT Bear's

The Bear in these captures runs **Catppuccin Latte**, a third-party theme the
user selected — base `#eff1f5`, mantle `#e6e9ef`, teal `#179299`, all exact
palette matches. Every colour measured below therefore describes Catppuccin
Latte, not Bear's own design language, and none of it is an argument for
changing a token in `tokens.css`. What transfers is **structure, density and
shape**, which are the theme-independent parts.

### Geometry

| Surface | Bear | bear-web | Delta |
| --- | --- | --- | --- |
| Sidebar row height | 22 | 24 | +2, held on the 4px grid deliberately |
| Sidebar nesting indent step | ~13 | 12 | close enough |
| Sidebar group gap (lists → tags) | +13 | +16 | ours is already separated, slightly wider |
| Note list row height | 81 | 88 | +7, and now shows the same two snippet lines |
| Note list content per row | title + 2-line snippet + date | title + date + 2-line snippet | **order still differs — see below** |
| Note list divider | inset ~9 from the left | inset 12 | |
| Prose measure (rendered) | 643 | 640 | closed in M8 |
| Editor body size / line height | 16 / 1.6 | 16 / 1.6 | **identical** |
| Bottom toolbar | floating, ~380 x 37, fully rounded, centred, ~13 above the edge | floating, fully rounded, centred, 12 above the edge | closed in M8 |
| Top controls | two floating pill groups | one floating pill group, top right | closed in M8; we have no back/forward to group |
| Note-foot tag chip | 102 x 22, fully rounded, `#` glyph + name | (no equivalent) | |

### `--bear-line-width` is dead at 1440x900, and the token is the wrong value

Our editor pane is 840 wide; less its 24pt horizontal padding the prose column
is **792**, and `max-width: 896px` (`56em` at 16px) therefore never engages.
The token has been declared-and-inert since M5.5 in a second sense: M7.5 wired
it into `.ProseMirror`, but at this window size the clamp still does nothing.

Bear's rendered measure is **643pt = 40.2em at 16pt**. So the fix is not "wire
the token up" — it is already wired — it is to change the value to about `40em`,
at which point the clamp engages at 1440 wide and the column matches Bear's.

**A discrepancy worth recording rather than resolving:** Bear's own typography
panel reports its line width as `56 em`, the same number our token carries, while
rendering 40em. Bear's `em` here is therefore not a CSS `em`; the remaining 16em
is unexplained and may be container padding. Do not copy `56` into a CSS
`max-width` on the strength of the panel's label — copy the measured 40em, which
is what a user actually sees.

### Bear's own typography defaults, from its preferences panel

Read directly off Bear's 타이포그래피 pane, and the reason four of our five editor
tokens need no change:

| Bear preference | Bear default | Our token | Match |
| --- | --- | --- | --- |
| 글꼴 크기 (size) | 16 pt | `--bear-font-size: 16px` | yes |
| 줄 높이 (line height) | 1.6 em | `--bear-line-height: 1.6` | yes |
| 줄 너비 (line width) | 56 em (renders 40em) | `--bear-line-width: 56em` | **no — see above** |
| 단락 간격 (paragraph spacing) | 0 em | `--bear-para-spacing: 0em` | yes |
| 단락 들여쓰기 (paragraph indent) | 0 em | `--bear-para-indent: 0em` | yes |

Bear exposes exactly these five as sliders, plus three font pickers (text,
heading, code — it uses a separate heading family). That is the shape M8's
typography panel should take; our token set was already designed for it.

### Structural features Bear has and we do not

Visible in every capture, and a large share of the perceived quality gap. None
of these is styling — each is a document-model feature:

- ~~**Tables.**~~ Closed in M8c: real nodes, rendered in the editor and in
  every export.
- **Callout / panel blocks.** Measured: full-measure width, ~94 tall, tinted
  fill, a 6pt accent bar down the left edge, ~6 radius. Bear ships several
  variants (memo, warning).
- **Collapsible headings.** A chevron sits left of every heading, outside the
  measure, and folds the section beneath it.
- **Inline images and note thumbnails.** The first row of Bear's note list
  carries an image preview, which is why that row is 149 tall against 81.

### What Bear does that we deliberately do not, and should keep not doing

- **Bear's panes are flush inside one window, separated by hairlines.** Ours
  float as three rounded cards on `--bear-canvas`. That is the existing ruling
  (a browser tab has no window chrome, so depth substitutes for it) and this
  measurement is not an argument against it.
- **Bear colours its headings with the theme accent.** Ours keep
  `--bear-text`, because `--bear-accent` and `--bear-danger` hold the same value
  in both shipped themes and accent headings would make one colour mean both
  "heading" and "delete forever". Revisiting this needs the two tokens to
  diverge first.

### Still open: the note list row's reading order

Bear stacks **title, snippet, date**; ours stacks **title, date, snippet**. The
density pass deliberately did not change this, because `NoteListItem`'s
`aria-label` is `"{title}, {date}, {snippet}"` and two tests in
`NoteListItem.test.tsx` pin the snippet as the last thing announced. Reordering
the row visually without the label leaves a sighted user and a screen-reader
user hearing the date at different points; reordering both means editing a
pinned accessibility contract, which this project's own rules say is a
deliberate act and not a side effect of a restyle. It is a real difference, worth
closing, and worth closing on purpose.

### Still unverified: heading scale and paragraph rhythm

The M8 comparison closed the measure, the chrome shape and the density. It did
NOT settle the type scale. Bear's h2 measured roughly 1.5x its body text against
our `1.35em`, and its inter-paragraph gap looked larger than our `0.75em` — but
neither number was recorded here at the time, and the captures are gone, so
neither is trustworthy enough to act on.

**Do not change the heading scale or the block rhythm on the strength of those
figures.** Both need a fresh set of Bear captures saved to a real path, measured
the same way as the rest of this section: calibrate on the 24pt menu bar, then
read line pitch and band heights out of the prose column.
