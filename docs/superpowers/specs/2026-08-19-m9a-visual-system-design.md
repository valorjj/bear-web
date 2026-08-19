# M9a — Visual system: themes, scale, and the picker

**Date:** 2026-08-19
**Status:** approved, ready for planning
**Supersedes:** the "M9 themes, callouts, polish" line in `CLAUDE.md`'s status table

---

## 1. Why

The app was built as a Bear clone and measured against Bear. That is no longer
the goal. The goal is **a lightweight, fast, beautiful markdown app with image
storage**, and polished UI is the priority. Bear remains a useful reference and
a source of measurements; it is no longer the definition of correct.

Two concrete complaints motivated this milestone:

1. **No theme selection exists.** `tokens.css` has carried a `data-theme` seam
   since M2 and nothing has ever driven it.
2. **Padding and alignment drift visibly.** The shipped call sites use `px-1.5`,
   `px-3`, `pl-7`, `p-5`, `p-1`, `gap-0.5` — ten different steps with no stated
   rule. `DESIGN-bear-web.md` currently rules that no spacing scale is needed
   because Tailwind's grid is already 4px. That ruling is revised here: a grid
   on which every step is permitted is not a scale.

The chosen visual direction is **Soft Depth** at **balanced density** with an
**indigo-on-lilac** default palette — larger radii, layered elevation, rows as
floating chips, the sidebar dissolved into the ground.

### What this milestone is not

M9 decomposes into three sub-projects. This spec is the first only.

| | Sub-project | Depends on |
| --- | --- | --- |
| **M9a** | Visual system: token contract, five themes, picker, application pass | — |
| **M9b** | Callout blocks (schema node, tokenizer, serializer, export) | M9a tokens |
| **M9c** | Collapsible headings | M9a tokens |

M9b and M9c depend on M9a because both need tokens that do not exist yet, and
because a callout tint is only expressible once `--bear-accent` and
`--bear-danger` genuinely diverge — which M9a delivers.

**Image storage** is a wanted feature (blobs in IndexedDB, an editor node,
export embedding, backup/import). It is not scheduled and is not part of M9.

---

## 2. The token contract

Tokens split into three tiers by who owns them. The split is the foundation
everything else rests on.

### Tier 1 — theme palette (16 tokens, mandatory per theme)

`bg` `surface` `sidebar` `canvas` `text` `muted` `faint` `border` `accent`
`danger` `focus` `hover` `selected` `shadow` `tag-fill` `tag-fill-strong`

### Tier 2 — theme surface treatment (6 tokens, mandatory per theme)

`radius-sm` `radius-md` `radius-lg` `shadow-popover` `shadow-dialog`
`border-width`

Moving radii and shadows into the theme tier is what lets a flat theme look
genuinely flat beside Soft Depth, and it is what lets **High Contrast be an
ordinary theme** rather than a branching mode: it sets `border-width: 2px`,
`shadow-*: none`, and replaces the alpha-composited `hover`/`selected` with
solid fills. No component learns that High Contrast exists.

`--bear-border-width` is new. Every border in the app must consume it, or High
Contrast is a palette swap that fails to raise contrast where it matters most.

### Tier 3 — global, not themeable

Spacing scale, type scale, font families, durations, easing,
`--bear-line-width`, `--bear-para-spacing`, `--bear-para-indent`.

Density is a property of the app, not of a theme. A theme that could move the
spacing scale would multiply every screenshot and every measurement by the
theme count.

### Delivery

CSS remains the delivery mechanism: one block per theme, keyed
`:root[data-theme='<id>']`. No JavaScript ever applies a colour. This is what
keeps first paint free of a flash and keeps print and reduced-motion behaviour
honest.

The system default becomes:

```css
:root { /* indigo-light */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* indigo-dark */ }
}
```

**The guard changes from `:not([data-theme='light'])` to `:not([data-theme])`.**
With named themes, *any* explicit choice must beat the system preference, not
only a theme literally named `light`. Leaving the old guard in place would make
every named light theme silently lose to a dark OS setting — a defect invisible
on a light machine.

### Metadata

The picker needs to render and group the roster, so each theme also has a TS
record: `{ id, labelKey, group: 'light' | 'dark' }` in `src/styles/themes.ts`.

Two sources of truth must agree. `scripts/sourceLint.test.ts` asserts:

- every `id` in the TS roster has a matching CSS block, and vice versa;
- every CSS block defines **all 22** tier-1 and tier-2 tokens.

This **replaces** the current assertion that the two dark blocks are
token-for-token identical. That assertion had the right intent and the wrong
shape — it compares two specific blocks and cannot scale past two. The
replacement is strictly stronger.

---

## 3. The roster

Five themes. Two pairs plus one.

| Theme | id | Group | Origin |
| --- | --- | --- | --- |
| Indigo Light | `indigo-light` | Light | New. **Default.** |
| Indigo Dark | `indigo-dark` | Dark | New. Violet carried into the ground. |
| Paper | `paper` | Light | Existing warm light palette, unchanged |
| Ink | `ink` | Dark | Existing warm dark palette, unchanged |
| High Contrast | `high-contrast` | Dark | New. Stresses the surface tier. |

Paper and Ink are retained because they cost nothing and do real work: they are
a **genuinely warm palette beside a cool one**, which is the only honest test
that the token contract is not secretly indigo-shaped. A contract validated
against two indigo variants would prove very little. High Contrast is the only
theme that stresses tier 2 rather than tier 1.

### Provisional palette values

**These are starting points, not settled values.** The contrast harness
(§6) is authoritative: any pair that fails its threshold gets darkened or
lightened until it passes, and the final measured ratios are recorded in
`docs/design/DESIGN-bear-web.md`. Implementers must not treat a value below as
fixed if the harness disagrees with it.

#### `indigo-light` (default)

```
canvas   #eceaf3    text     #241f3d    accent   #5b4ad6
bg       #ffffff    muted    #6f6a87    danger   #dc2626
surface  #ffffff    faint    #9d99b0    focus    #5b4ad6
sidebar  #eceaf3    border   #e4e1ee

hover            rgb(40 34 66 / 0.05)
selected         rgb(91 74 214 / 0.09)
shadow           rgb(40 34 66 / 0.07)
tag-fill         rgb(91 74 214 / 0.12)
tag-fill-strong  rgb(91 74 214 / 0.26)

radius-sm 6   radius-md 8   radius-lg 12   border-width 1px
shadow-popover  0 1px 2px rgb(40 34 66 / .05), 0 8px 24px rgb(40 34 66 / .07)
shadow-dialog   0 12px 40px rgb(40 34 66 / .18)
```

`sidebar` deliberately equals `canvas`: in Soft Depth the sidebar dissolves into
the ground and only the panes holding content float.

#### `indigo-dark`

```
canvas   #14121b    text     #f0edf7    accent   #9b8cff
bg       #1e1b26    muted    #a9a3bd    danger   #ff6b6b
surface  #1e1b26    faint    #6f6a85    focus    #9b8cff
sidebar  #14121b    border   #2e2a3a

hover            rgb(255 255 255 / 0.06)
selected         rgb(155 140 255 / 0.20)
shadow           rgb(0 0 0 / 0.40)
tag-fill         rgb(155 140 255 / 0.22)
tag-fill-strong  rgb(155 140 255 / 0.38)

radius/border    as indigo-light
```

#### `paper` and `ink`

Exactly today's `:root` and `:root[data-theme='dark']` values, moved into named
blocks. Their tier-2 values keep today's radii (4 / 6 / 10), today's two
shadows, and `border-width: 1px`. They are the only themes whose contrast
ratios are already measured and recorded; the harness must reproduce those
recorded numbers, which makes them its calibration case.

#### `high-contrast`

```
canvas   #000000    text     #ffffff    accent   #ffd400
bg       #000000    muted    #e6e6e6    danger   #ff6b6b
surface  #000000    faint    #c9c9c9    focus    #ffd400
sidebar  #000000    border   #ffffff

hover            #2a2a2a   (solid, not alpha)
selected         #4a3d00   (solid, not alpha)
shadow           transparent
tag-fill         #4a3d00   (solid)
tag-fill-strong  #6b5800   (solid)

radius-sm 2   radius-md 4   radius-lg 6   border-width 2px
shadow-popover  none
shadow-dialog   none
```

With `shadow-*: none`, a popover is separated from the page by its 2px border
alone. Every floating surface must therefore carry a border, not rely on
elevation — a rule that only bites in this theme, which is exactly why the
theme is in the roster.

---

## 4. The picker

No settings surface exists anywhere in the app. The sidebar pane holds
`SmartListSidebar` and `TagSidebar` and nothing else; `ConfirmDialog` is the
only dialog primitive.

- **Entry point:** a new sidebar footer. It is the only pane with room, and it
  places appearance next to navigation rather than inside a note. Icon-only,
  therefore carrying an `aria-label` from `useT` per the existing accessibility
  rule. Permitted to be icon-only because it is not destructive.
- **Surface:** a popover listing themes grouped under **Light** and **Dark**
  headings, with a **System** entry above both groups. Each row shows the theme
  name and a swatch of its own `canvas` and `accent`, so the list previews
  itself.
- **New primitive:** `src/ui/Popover.tsx`. `ConfirmDialog` is modal and wrong
  for this, and its focus trap queries `'button'` specifically — a documented
  gap that must not be extended to a surface containing grouped rows and
  headings. The new primitive uses a standard focusable selector from the
  start.
- **Applying:** sets `data-theme` on `document.documentElement`. That is the
  entire runtime. `System` removes the attribute.
- **Keyboard:** Escape closes and returns focus to the trigger; Up/Down move
  between rows; Enter selects. Rows are `role="menuitemradio"` with
  `aria-checked`, grouped by `role="group"` with an `aria-label`.

### Persistence and first paint

- `settings.set('theme', id)` is the durable record, consistent with pane widths
  and with IndexedDB being the single source of truth for durable data.
- The value is **mirrored synchronously to `localStorage`**.
- A short inline script in `index.html` reads the mirror and stamps
  `data-theme` before first paint.

IndexedDB can only be read asynchronously, so it cannot possibly paint the
first frame. Without the mirror, every launch paints the default theme and then
corrects itself — a visible flash on every load, worst in the dark themes.

**The mirror is a paint-time cache, not a second source of truth.** On boot the
settings table wins: if the two disagree, the settings value is applied and the
mirror rewritten. The inline script reads and writes an **id**, never a colour,
so the "every colour comes from a custom property" rule is intact — but this is
the first colour-adjacent logic outside `tokens.css`, and
`scripts/sourceLint.test.ts` must know about it explicitly rather than failing
to notice it.

---

## 5. The application pass

### Spacing

The current ruling — "there is deliberately no spacing scale, Tailwind's 4px
grid is enough" — is **revised**. The evidence against it is the shipped code:
ten distinct steps with no rule.

The fix is not a second token system competing with Tailwind. It is **a
permitted subset of Tailwind's own scale, enforced by a test**. Ordinary
Tailwind utilities keep being written; `scripts/sourceLint.test.ts` fails on a
step outside the set — the same mechanism that already catches a stray hex
literal.

**Permitted steps (px): 2, 4, 8, 12, 16, 24, 32, 48.**
As Tailwind utilities: `0.5, 1, 2, 3, 4, 6, 8, 12`.

The scan is subject to the same documented-heuristic caveat as the colour scan:
it inspects `className` regions, and arbitrary-value utilities
(`p-[13px]`) are a deliberate escape hatch that the test flags rather than
forbids, because the editor reserve (`pt-12`/`pb-24`) and similar computed
values have legitimate reasons to sit off-scale. Those get an allowlist with a
stated reason each, exactly like the focus-outline suppressors.

### Snapping the mockup

The approved mockup is **not** on a 4px grid — it used a 9px gutter, 13px
radius, and 3px/7px margins. Shipped values are snapped:

| Element | Mockup | Ships as |
| --- | --- | --- |
| Pane gutter | 9 | **8** |
| Pane radius | 13 | **12** (`radius-lg`) |
| Sidebar row | 30 tall, 10 pad | **32 tall, 12 pad** |
| Note list row | 10/13 pad, 3/7 margin | **12 pad, 4/8 margin** |
| Row radius | 8/9 | **8** (`radius-md`) |

The snap is visually imperceptible and is what makes the scale statable and
therefore enforceable.

Radii rise from today's 4 / 6 / 10 to **6 / 8 / 12** for the indigo themes.
Soft Depth needs more radius than the current values provide.

### Type

The five UI sizes stay. What changes is that **hierarchy currently comes from
size alone**, which is why the chrome reads flat. Weight and letter-spacing
become part of each step rather than being applied ad hoc at call sites.

For editor headings, `DESIGN-bear-web.md` records that the heading scale and
paragraph rhythm were never trustworthily measured and warns against acting on
the remembered figures. Since Bear is no longer the authority, **the scale is
chosen deliberately** rather than measured off a screenshot: a modular scale
with `h1` / `h2` / `h3` as fixed multiples of the body size, stated in the
design doc with its ratio.

`--bear-para-spacing` and `--bear-para-indent` remain additive and remain at
`0em`; this milestone does not add sliders.

---

## 6. Verification

The project's own rules state that nothing in the suite can see "renders
wrong", and that contrast ratios are measured by hand because jsdom has no
cascade. **Five themes make hand-measurement untenable**, and a bad ratio is the
failure most likely to ship silently.

### 6.1 Automated contrast harness (new, required)

A Playwright spec that, for every theme in the roster, applies the theme and
reads **computed** colours off real elements, then asserts:

| Pair | Threshold |
| --- | --- |
| `text` on `bg` / `surface` / `sidebar` / `canvas` | 4.5:1 |
| `muted` on the same grounds | 4.5:1 |
| `faint` on the same grounds | 3.0:1 |
| `accent` on the same grounds | 4.5:1 (it carries links) |
| `danger` on the same grounds | 4.5:1 |
| `border` on its adjacent ground | 3.0:1 |
| `text` on a `selected` row, composited | 4.5:1 |

Chromium composites the alpha overlays for us, which is precisely what jsdom
cannot do and why this was hand-measured until now. **This retires the "no test
can catch this" rule** and is the highest-value item in the milestone.

Paper and Ink are its calibration case: their ratios are already recorded by
hand, so the harness must reproduce those numbers before its verdicts on the
new themes are trustworthy.

### 6.2 `scripts/sourceLint.test.ts`

Three new assertions, one replacement:

- **replaced:** "the two dark blocks are token-for-token identical" → "every
  theme block defines all 22 tier-1/tier-2 tokens";
- TS roster ↔ CSS blocks agree in both directions;
- spacing and radius utilities stay inside the permitted set, with an
  allowlist carrying a stated reason per exception;
- the inline theme script in `index.html` is explicitly known to the source
  scan.

### 6.3 `e2e/appearance.spec.ts`

- Selecting each theme changes computed colour on a real element.
- The choice survives a reload.
- **No flash:** `document.documentElement`'s `data-theme` is already correct at
  first paint. Asserted by recording the attribute at the earliest observable
  moment rather than after load, so a late-stamping implementation fails.
- Every existing relative assertion still passes **in every theme**, not only
  the default.

### 6.4 Existing suites

- `e2e/smoke.spec.ts` pins the shipped palette deliberately, so the new default
  requires a **conscious edit** there. This is the licensed case for editing it.
- `npm run shots` and `npm run measure` iterate the roster rather than
  capturing one theme.
- A role-based or geometry test failing during this restyle is a **behaviour
  report, not a stale expectation** — the standing rule applies with full force
  in a milestone that touches every surface.

---

## 7. Consequences and rulings

- **`--bear-accent` and `--bear-danger` now genuinely diverge per theme.** The
  standing ruling that headings keep `--bear-text` was justified by the two
  tokens being identical; that justification is gone. Headings nevertheless
  **stay on `--bear-text` in this milestone** — the ruling is re-decided on its
  own merits later, not reversed as a side effect.
- **Bear's measurements stop being the authority.** `measurements.md` and the
  "Measured against the real Bear" section stay valuable as self-comparison and
  regression tooling — still the only thing that can see "renders wrong" — but
  a divergence from Bear is no longer a defect on its own.
- **`--color-hover` precedent.** Tailwind v4 emits nothing for a utility whose
  theme key is absent, silently. Every new token added here must have at least
  one asserted call site, or it is indistinguishable from a token that does not
  exist. This project has shipped that defect three times.
- **The note-list header and the row reading order stay deferred.** Both are
  real and both are listed as open; neither is required by the token contract,
  and the reading order change means editing a pinned accessibility contract,
  which must be a deliberate act rather than a side effect of a restyle.

---

## 8. Out of scope

- Callout blocks (M9b) and collapsible headings (M9c).
- Image storage.
- Typography preference sliders. The five editor tokens stay wired and
  unexposed.
- Tag rename and delete; syntax-visibility toggling.
- Any theme beyond the five listed. Adding a sixth must be a data change once
  this contract exists — if it is not, the contract failed.
