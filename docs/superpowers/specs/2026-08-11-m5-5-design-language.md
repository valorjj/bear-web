# M5.5 — Design language

Status: design approved, not implemented
Parent spec: `docs/superpowers/specs/2026-08-06-bear-web-design.md`
Successor: `docs/superpowers/specs/2026-08-11-m6-smart-lists-design.md`

An interlude between M5 and M6, not a renumbering of the roadmap. It exists
because M6 adds a seven-row sidebar section, the app's first modal, and a pin
affordance; M7 adds search results and a command palette; and M8's theme picker
*consumes* a token system. Landing the visual language after those means
restyling three milestones of components. Landing it before M6 means M6 is built
to it once.

The project's stated reason for existing is that Bear is polished. The app is
currently correct and unstyled — it reads as a working wireframe. This milestone
closes that gap and, more importantly, makes the gap closable by anyone later,
because the decisions become tokens and tests rather than judgement applied
per-component.

## Two defects found while scoping this

**The typefaces have never rendered.** `tokens.css` has declared
`--bear-font-sans: 'Pretendard', system-ui, sans-serif` and
`--bear-font-mono: 'JetBrains Mono', ui-monospace, monospace` since M2. There is
no `@font-face`, no `<link>` in `index.html`, and no font package in
`package.json`. Every build since M0 has silently fallen back to `system-ui` —
on macOS that is tolerable, but Korean on Windows falls to Malgun Gothic. The
tokens have been describing a typeface the app does not have, and nothing failed.

**Selection is rendered backwards.** Selected sidebar rows and note-list rows
both get `bg-bg`. On the grey sidebar and the off-white note list, that means
"selected" currently has *less* contrast against its container than "unselected"
does. It reads as a hole rather than a highlight.

## Scope

M5.5 delivers:

- `docs/design/DESIGN-bear-web.md` — the design language, in the machine-readable
  format of `docs/design/DESIGN-discord.md`
- self-hosted typefaces, actually loaded
- `tokens.css` grown from a palette into a system: role colours, a UI type scale,
  radii, elevation, motion
- `src/ui/` rebuilt against it, plus one new primitive
- every existing surface restyled
- three new **enforceable** test classes for rules the project currently states
  but does not check

**Not in M5.5:** the theme picker (M8 — this milestone only makes the token set
worth switching), editor typography controls (M8, already tokenized), empty-state
illustrations (M9), and any behaviour change whatsoever. **No component's
behaviour, props contract, or accessibility semantics change** except where this
spec names it explicitly.

## On the Discord reference

`docs/design/DESIGN-discord.md` is adopted as a **template** and rejected as a
**reference**.

Its format is good and is copied directly: YAML frontmatter carrying `colors`,
`typography`, `rounded`, `spacing`, and a `components` map whose values are token
*references* (`"{colors.primary}"`) rather than literals, followed by prose
sections ending in Do's and Don'ts. The reference indirection maps cleanly onto
this project's existing rule that every colour comes from a custom property.

Its content is wrong for this app twice over. First, mood: it is 82px all-caps
display type over magenta gradients on deep indigo, described by its own
frontmatter as "arcade-energetic." Bear's polish is quietness. Second, and more
practically, it is an extraction of a **marketing site**, not an application —
its component vocabulary is `hero`, `cta-band`, `stat-card`,
`feature-card-gradient`, `showcase-band-black`. It contains no list row, no
sidebar item, no modal, and no input. A landing page shouts once; an application
has to be livable for eight hours.

## Identity

Warm greyscale, one red accent, 13px UI type.

The current palette is subtly cool — the sidebar is `#eceef3`, which is
blue-grey. Bear's greys are warm. Shifting the neutral ramp warm is a small
change with a large effect on whether the app feels like a writing tool or an
admin panel.

The current UI type is one notch too large throughout: `text-sm` (14px) is the
workhorse, with `text-xs` (12px) for secondary text. A macOS-idiom application
uses 13px as its workhorse. That single shift does a surprising amount of the
work of making this read as an app rather than a web page.

Default themes carry original names, per the parent spec's IP section:
**Paper** (light) and **Ink** (dark).

## Colour tokens

The seven existing role names are kept. Six are added.

| Token                | Role                                            |
| -------------------- | ----------------------------------------------- |
| `--bear-bg`          | editor canvas                                   |
| `--bear-surface`     | note list                                       |
| `--bear-sidebar`     | sidebar                                         |
| `--bear-text`        | primary text                                    |
| `--bear-muted`       | secondary text — snippets, body copy            |
| `--bear-faint`       | **new** — tertiary: counts, timestamps          |
| `--bear-border`      | hairlines                                       |
| `--bear-accent`      | the red                                         |
| `--bear-hover`       | **new** — hover fill                            |
| `--bear-selected`    | **new** — selected fill                         |
| `--bear-danger`      | **new** — destructive actions                   |
| `--bear-focus`       | **new** — focus ring                            |
| `--bear-shadow`      | **new** — shadow colour                         |

### `hover` and `selected` are translucent, and that is the point

They sit over three different backgrounds — sidebar, note list, and editor
canvas — so a solid fill cannot be one token. They are defined as alpha overlays
(`rgb(0 0 0 / 0.045)` and an accent-tinted `rgb(<accent> / 0.10)` in Paper,
lightened equivalents in Ink) which compose correctly over any surface.

`--bear-selected` is accent-tinted rather than neutral. Combined with an accent
left-edge marker on the selected row, this fixes the backwards-contrast defect:
selection becomes *more* present than its surroundings, not less.

### `danger` and `focus` are separate tokens that happen to equal `accent`

Both resolve to the accent red in Paper and Ink. They exist as distinct names so
that an M8 theme can diverge — a green-accented theme must not render its Delete
Forever button green — and so that call sites express intent rather than colour.
This is the same reasoning that keeps `--bear-surface` and `--bear-sidebar`
separate even where a theme gives them the same value.

### Theme structure is unchanged

The three-block structure from M2 stays exactly as it is: bare `:root` defines
Paper, `:root[data-theme='dark']` defines Ink, and
`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`
repeats Ink. Every new token must be defined in all three places. Simplifying
the `:not([data-theme='light'])` selector remains forbidden — it is the seam M8's
picker drives.

## Typography

### Fonts are self-hosted and actually loaded

`pretendard` (dynamic subset) and `@fontsource-variable/jetbrains-mono`, both
from npm, imported in `index.css`. The dynamic subset splits by `unicode-range`,
so a note written in English pulls only Latin ranges and a Korean note pulls only
the Hangul ranges it uses.

Self-hosting over a CDN: the app is a static Pages deploy with no backend and a
privacy story that says nothing leaves the browser. A font CDN is an outbound
request to a third party on every load, which contradicts that for no benefit.

**Accepted cost:** bundle size grows. For a Korean-first writing application
where type is the product, and given range-splitting, this is worth it.

### UI type scale

Separate from editor typography, which already has its own tokens bound to M8's
sliders and is not touched here.

| Token          | Size / line-height | Used for                          |
| -------------- | ------------------ | --------------------------------- |
| `--text-ui-xs` | 11px / 1.4         | counts, badges                    |
| `--text-ui-sm` | 12px / 1.45        | timestamps, snippets              |
| `--text-ui`    | 13px / 1.45        | **workhorse** — rows, buttons     |
| `--text-ui-md` | 14px / 1.4         | note titles                       |
| `--text-ui-lg` | 16px / 1.35        | pane headers, empty-state titles  |

## Spacing — deliberately no new tokens

Tailwind v4's default scale is already a 4px grid (`--spacing: 0.25rem`), so
`p-2` is 8px and `p-3` is 12px. The app's problem is not a missing scale; it is
inconsistent use of the one it has.

Inventing `--space-md` on top of that would produce two parallel scales and a
standing question about which to reach for. Instead the design doc records
**density rules** as prose, and the primitives encode them:

| Surface        | Rule                                                       |
| -------------- | ---------------------------------------------------------- |
| Sidebar row    | 28px tall, `px-2`, `gap-2`, `--text-ui`                     |
| Note list row  | `px-3 py-2.5`; title `--text-ui-md` semibold, meta `--text-ui-sm` |
| Toolbar        | 36px tall, `px-2 gap-1`                                     |
| Dialog         | `p-5`, `gap-4`                                              |

## Radii, elevation, motion

**Radii** — `sm 4px`, `md 6px`, `lg 10px`. Small; rows and buttons are `sm`, the
dialog is `lg`. Tailwind's defaults (4/6/8) are close but the `lg` value matters
for the dialog and is worth pinning.

**Elevation** — two shadows only: `--shadow-popover` and `--shadow-dialog`, both
built on `--bear-shadow` so they darken correctly in Ink. There is no elevation
scale because the app has exactly two floating surfaces, one of which does not
exist yet.

**Motion** — `--bear-duration-fast: 100ms` (hover, selection fills),
`--bear-duration: 160ms` (disclosure, dialog), and one easing token. Applied to
hover and selected fills, the tag-tree disclosure arrow, and the dialog's
fade-and-scale entrance.

The app currently has motion in exactly one place: `Resizer`'s hairline
transitions to accent on hover. Everything else snaps.

**`prefers-reduced-motion: reduce` sets both duration tokens to `0ms`.** Because
motion is expressed as tokens rather than per-component durations, this is one
media block that covers every animation in the app — including animations added
later, which is the actual argument for tokenizing duration at all.

## Focus

A global `:focus-visible` rule in `index.css`, driven by `--bear-focus`, replaces
the per-component `focus-visible:outline-*` utilities scattered through the
codebase today (`Button` has one; most interactive elements have none).

No component may set `outline-none` without supplying a visible replacement.

## `src/ui/` rebuild

`src/ui/` keeps its boundary absolutely: it imports **nothing** from `src/app/`,
`src/data/`, `src/features/`, or `src/i18n/`. Every string arrives as a prop,
already translated by the caller.

**`Button`** gains a `variant` of `default | primary | danger | ghost`, a `size`
of `sm | md`, and a `disabled` state. M6's Delete Forever needs `danger` and
there is no such thing today; M6's Empty Trash needs `disabled`. The existing
props (`onClick`, `children`, `label`, `className`) are unchanged, and both new
props default to today's appearance, so no existing call site changes behaviour.

**`SidebarRow`** — new. A row with an optional leading disclosure control, an
optional icon slot, a truncating label, an optional trailing count, and
`selected` / `onSelect`. It has three consumers: the M5 tag tree, M6's smart
lists, and M7's search results. It is pure presentation — it knows nothing about
scopes, tags, or notes — so it belongs in `src/ui/` rather than in a feature.

Extracting it now rather than after M6 is the point of the sequencing: otherwise
the tag row and the smart-list row are written twice and diverge.

**`EmptyState`** — typography pass onto the new scale. No API change.

**`Resizer`** — the hairline widens on hover in addition to changing colour, and
the transition moves onto the motion tokens. No API change, no change to the
pointer-capture or keyboard paths, both of which are load-bearing and tested.

**`Pane`** — untouched. It is a layout wrapper with no visual surface of its own.

## Surfaces restyled

`TagSidebar`, `NoteList`, `NoteListItem`, `EmptyState`, the editor's
`TopControls` and `BottomToolbar`, and `UnavailableBanner`. `ScopeSidebar` is
**not** restyled — M6 deletes it, and styling a file scheduled for deletion is
waste.

## Testing

Existing behavioural tests must stay green. Where a test breaks because it
asserts a Tailwind class name, **the test is the defect** and is rewritten to
assert role, accessible name, or `aria-current` instead. A visual refactor that
cannot change any class name without reddening the suite is a suite that has
pinned the wrong thing.

### Three new enforceable test classes

Each of these converts a rule the project already states into something that
fails when violated. The precedent is the underline mark: the spec, `CLAUDE.md`,
and a passing test all asserted a rule while the app shipped violating it for an
entire milestone, because the test checked the UI instead of the schema.

**1. Token lint.** No colour literal outside `tokens.css`. A test scans
non-test sources under `src/` for hex colours and `rgb(` / `hsl(` calls and
asserts none are found. CLAUDE.md already calls a literal hex outside
`tokens.css` "a defect"; nothing has ever checked.

*Known limitation, and the reason the scan is narrowed:* a naive `#[0-9a-f]{3,6}`
pattern matches Markdown and tag fixtures — `#face` and `#dad` are valid tags and
valid hex. The scan therefore excludes `*.test.ts(x)` and requires the match to
sit inside a `className`, a `style` value, or a `.css` file. This is a heuristic,
not a proof; it catches the realistic mistake (someone typing a colour into a
component) and is documented as not catching every conceivable one.

**2. Reduced motion.** A test asserts `tokens.css` contains a
`prefers-reduced-motion: reduce` block that sets both duration tokens to zero.
This is a source-content assertion rather than a rendered-behaviour one, because
jsdom has no cascade and cannot evaluate a media query. It is weak but
falsifiable: deleting the block reddens it.

**3. Font loading.** A test asserts the font packages are imported and that
`--bear-font-sans` names a family the app actually ships. This is the assertion
whose absence let the current defect live since M2.

### Falsification

Per project practice, each must be shown to fail when broken:

- Put `#ff0000` in a component's `className` → token lint reddens.
- Delete the reduced-motion block → its test reddens.
- Remove the font import → the font test reddens.
- Remove `variant="danger"` handling from `Button` → a variant test reddens.
- Give `SidebarRow` an import from `src/features/` → the existing architecture
  boundary test reddens.

### Not tested, honestly

**Contrast ratios are not asserted.** Computing WCAG contrast for
alpha-composited overlays over three different surfaces in two themes needs a
real cascade, which jsdom does not have. They are checked by hand during
implementation and recorded in the design doc; a future Playwright pass could
compute them from real rendered pixels.

**Focus rings are asserted only structurally.** jsdom renders no CSS, so a test
can assert that a global `:focus-visible` rule exists in source and that no
primitive sets `outline-none`, but not that a ring is visible. Real focus
behaviour belongs in Playwright, alongside the existing pointer-drag tests that
are there for the same reason.

## Deferred, with rulings

- **Visual regression screenshots.** Tempting, and self-hosted fonts would make
  baselines more stable than they usually are. Not now: CI runs Linux while
  development is macOS, so baselines would differ by platform and the suite
  would either be flaky or Linux-only. Revisit if design churn becomes expensive
  to verify by eye.
- **A theme registry.** M8 owns it. This milestone produces the token set a
  registry would map over, and deliberately stops there.
- **Icons.** The tag tree uses `▸`/`▾` text glyphs today. An icon set is a
  dependency decision with its own licensing question and belongs with M9's
  polish pass. Density and type carry this milestone without it.
- **Editor typography.** Already tokenized and bound to M8's sliders. Touching
  it here would collide with that milestone.
