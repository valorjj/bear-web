# F — The theme system: derivation, roster, and picker

Written 2026-08-24. Sub-project **F**, named in this session alongside **E**
(editor affordances, shipped 2026-08-24) and ahead of **C** (code block
language and highlighting, still queued).

The letters are `docs/superpowers/NEXT.md`'s and are not milestone ids. F did
not exist in that file before today: it was raised by the user as request 5 of
five, "Theme selector. we have deferred it. I expect many more theme."

## Purpose

M9a shipped five themes, a picker, a contrast harness and the paint-time
mirror that applies a theme before first paint. What it did not ship is a way
to add a sixth cheaply.

A theme today is a row in `src/styles/themes.ts` plus a CSS block in
`src/styles/tokens.css` holding **26 hand-picked values**, and
`scripts/sourceLint.test.ts` enforces that every roster id has a block
defining all of them. Five themes is 130 values. The twenty-theme roster the
user's Bear screenshots show would be 520, and each one is a place a
contrast floor can be missed.

F does three things:

1. **Derives most of a theme from a few chosen colours**, so a new theme block
   is about eight declarations rather than twenty-six.
2. **Grows the roster from five to sixteen.**
3. **Replaces the picker** with a scrollable card grid, because a 16px swatch
   told the user nothing useful even at five themes and tells them less at
   sixteen.

## Reference

Four screenshots of Bear's 환경설정 → 테마 pane, supplied by the user on
2026-08-23: a two-column scrollable grid of cards, each card painted in its
own theme and showing a heading plus two lines of sample prose with a bold run
and an accent-coloured run.

Bear is a reference, not a target — CLAUDE.md's standing rule. Every place
this spec diverges says why.

## Decisions already taken

Each of these closes a question that would otherwise be re-opened mid-build.

### Derivation happens in CSS, not in a build step and not at runtime

The hard constraint is `design-tokens-and-layout.md`'s: **first paint must be
free of JavaScript**. `index.html` carries an inline script that stamps
`data-theme` on `<html>` before the stylesheet paints, and every colour comes
from the cascade. A runtime generator is therefore impossible; the only
question was CSS-native derivation versus a build-time code generator writing
`tokens.css`.

CSS-native was chosen. A generator would have kept the computed values as
plain hex — which, see below, is not nothing — but it adds a generated file to
review, a second place to look when a colour is wrong, and a test asserting
the committed output matches a fresh run. CSS-native keeps "colours live only
in `tokens.css`" literally true, and keeps `ThemePicker`'s existing trick
working: a swatch previews its theme by being rendered inside `data-theme` and
letting the cascade colour it, so no colour ever enters TypeScript.

**Verified by spike before this spec was written, not assumed:**

| Question                                              | Result                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| Does `color-mix()` survive the Vite/Lightning build?  | Yes                                               |
| Does deriving from `var(--bear-accent)` follow the theme? | Yes — `ink` and `indigo-light` derive different values from one rule |
| `rgb(from #literal …)`                                | evaluated at build time down to plain hex         |
| Computed value format of a derived token              | `color(srgb 0.36 0.29 0.84 / 0.12)`               |

### The derived split, measured from the five existing themes

Not chosen by taste. Every ratio below was computed from the shipped palettes:

| theme         | muted | faint | border | selected α | tag α | tagStrong α | hover α | focus == accent |
| ------------- | ----- | ----- | ------ | ---------- | ----- | ----------- | ------- | --------------- |
| paper         | 66.6% | 54.2% | 13.0%  | .11        | .16   | .32         | .05     | yes             |
| indigo-light  | 71.8% | 55.6% | 13.2%  | .09        | .12   | .26         | .05     | yes             |
| indigo-dark   | 68.1% | 50.5% | 11.3%  | .20        | .22   | .38         | .06     | yes             |
| ink           | 62.4% | 44.2% | 11.9%  | .18        | .18   | .32         | .06     | yes             |
| high-contrast | 90.2% | 78.8% | 100%   | opaque     | opaque| opaque      | opaque  | yes             |

`muted`, `faint` and `border` are all `text` mixed toward `bg` at a
near-constant ratio, and **`focus` is literally `accent` in all five themes**.

**Chosen per theme (7):** `bg`, `surface`, `sidebar`, `canvas`, `text`,
`accent`, `danger`.

The four surfaces stay chosen rather than derived because their stepping is
genuinely per-theme: light themes step *down* in lightness from `bg`, dark
themes step *up*, and `ink` steps its sidebar up where `indigo-dark` steps its
own down. They also carry the theme's tint (paper's are warm, indigo's
violet), which a mix with `bg` alone would lose.

**Derived once in `:root` (12):**

```
/* opaque mixes: in oklab */
muted           = color-mix(in oklab, text 68%, bg)
faint           = color-mix(in oklab, text 51%, bg)
border          = color-mix(in oklab, text 12%, bg)
focus           = accent

/* alpha tints: in srgb */
hover           = color-mix(in srgb, text   calc(var(--bear-hover-a) * 100%), transparent)
selected        = color-mix(in srgb, accent calc(var(--bear-tint) * 100%), transparent)
tag-fill        = color-mix(in srgb, accent calc(var(--bear-tint-mid) * 100%), transparent)
tag-fill-strong = color-mix(in srgb, accent calc(var(--bear-tint-strong) * 100%), transparent)
hl-blue|green|pink|purple = color-mix(in srgb, <fixed hue> calc(var(--bear-hl-a) * 100%), transparent)
```

**Two colour spaces, deliberately, and the split is not arbitrary.** The three
opaque mixes use `oklab`, because perceptual evenness is the entire reason one
ratio can serve sixteen palettes: an sRGB midpoint between a dark text and a
light background lands visibly darker in some hues than others, which would
make `muted` inconsistent across the roster. The alpha tints use `srgb`,
because mixing a colour with `transparent` in `oklab` interpolates through a
premultiplied space and shifts hue as it fades — the result is not the plain
alpha these tokens have always been. Do not "tidy" the two into one space.

**Scheme scalars (5, all new):** `--bear-tint`, `--bear-tint-mid`,
`--bear-tint-strong`, `--bear-hover-a`, `--bear-hl-a`. Light values live in
`:root`; a dark theme overrides them.

`shadow` is the twentieth colour token and belongs to neither group: it is
chosen per theme, because light themes use a dark tint of their own at 7–14%
alpha — near their `text` but not equal to it — while dark themes use plain
black at 40–50%, and no single rule covers both. That
accounts for all twenty colour tokens: 7 chosen + 12 derived + `shadow`.

**The six non-colour tokens get defaults in `:root`, but they genuinely vary
and are NOT unified.** An earlier draft of this spec claimed they were
identical except in `high-contrast`. That was wrong, and checking it is what
found the error — there are three distinct radius families across five themes
(`paper` and `ink` at 4/6/10, the two indigo themes at 6/8/12,
`high-contrast` at 2/4/6) and three distinct shadow treatments (`paper`/`ink`
a single layer over `var(--bear-shadow)`, indigo a two-layer literal,
`high-contrast` a ring rather than a shadow at all).

So `:root` carries **one default geometry family** — indigo's 6/8/12 radii,
the two-layer shadow, `border-width: 1px` — and any theme that wants a
different one overrides it, exactly as today. The two-layer shadow is the
default because `tokens.css`'s own comment records why it was chosen: "Two
layers, which is what reads as depth rather than as a drop shadow."

**Unifying them was considered and rejected**, even though it would have made
every theme shorter. `paper` and `ink` would visibly change, which
contradicts this spec's own guarantee that the five shipped themes render
identically after the refactor. A silent restyle of two themes is not a
refactor.

Counting honestly, then: a **new** theme adopting the default geometry
declares about eight properties if light and thirteen if dark, against
twenty-six today — and that is the number that matters, because it is the cost
of the eleven themes F adds. The existing five keep their overrides and land
at eight to eighteen, all of them rendering byte-identically.

### No second attribute, and no grouped selector

Two tempting shapes were considered and rejected.

**A `data-scheme="dark"` attribute** carrying the dark scalars, stamped
alongside `data-theme`. Rejected: the inline script in `index.html` and the
no-JS first paint are the most carefully guarded thing in
`design-tokens-and-layout.md`, and four repeated declarations per dark theme
is a far cheaper price than touching the boot path.

**A grouped `[data-theme='a'], [data-theme='b'] { … }` selector** listing
every dark theme. Rejected on a documented mechanical fact:
`sourceLint.test.ts`'s `blockTokens` helper finds a block by `indexOf` plus
the next brace and **cannot read a grouped selector at all** — the same reason
that file already forbids merging `:root` with the default theme's block.

### Overriding a derived token stays first-class

Derivation is the default, never a straitjacket. A theme block comes after
`:root` in the stylesheet and both match `<html>` at equal specificity, so any
explicit declaration in the theme block wins.

This is not a hypothetical escape hatch — it is already how two shipped themes
work. `indigo-light`'s `--bear-faint` carries a comment recording that it was
darkened from the mockup, which the harness had measured at 2.76:1 against a
3.0 floor. `high-contrast` is an exception on nearly every row: opaque fills,
a pure-white border, far brighter `muted` and `faint`. Both keep their
explicit values and both must stay byte-identical after this change.

### The roster is sixteen, and most of it is other people's palettes

**Light:** Indigo Light *(default, exists)*, Paper *(exists)*, Solarized
Light, Rosé Dawn, Latte, Gruvbox Light, Snow, Sepia.

**Dark:** Indigo Dark *(exists)*, Ink *(exists)*, High Contrast *(exists)*,
Nord, Dracula, Solarized Dark, Tokyo Night, Gruvbox Dark.

Sixteen rather than Bear's roughly twenty, because four of Bear's are near
duplicates of one another (three Duotone variants, two Ayu). Sixteen distinct
palettes reads as a larger roster than twenty containing four pairs, and every
theme still has to clear the contrast harness — per-theme work that derivation
does not remove.

Solarized, Nord, Dracula, Gruvbox, Rosé Pine, Catppuccin and Tokyo Night are
published open-source colour schemes under permissive licences. Each block
gets an attribution comment naming the scheme and its author, the same way
`Icon.tsx` records that its path data is copied verbatim from lucide. *Sepia*
and the existing five are ours. **Snow** is derived from Nord's own "Snow
Storm" range and is not an official upstream light theme; it is named
honestly rather than implying one.

**Fidelity loses to legibility where they conflict, and they will.**
Solarized's base tones are famously low-contrast and `muted` will not clear
4.5:1 unmodified. A Solarized that is slightly darker than upstream and
readable beats one that is faithful and fails the harness. Where a palette is
adjusted, the block says so and says by how much.

### The picker becomes a modal dialog

One constraint decides this, and it is already documented in `Popover.tsx`:
the sidebar `Pane` carries `overflow-hidden`, so an anchored surface wider
than the pane is **clipped**, not merely overlapping. `AccountMenu` had to
escape to `position: fixed` with computed viewport coordinates for exactly
this reason. Today's picker is `w-44` (176px) inside a 240px sidebar and fits;
a two-column card grid at roughly 420px would not.

Three shapes were considered: a modal dialog, a taller scrollable list that
stays inside the current popover width, and a `fixed`-positioned wide grid
using `AccountMenu`'s escape hatch. The modal was chosen. It matches the
reference, it sidesteps clipping and the resizable-sidebar interaction
entirely, and choosing among sixteen previews is a deliberate moment rather
than a quick menu pick.

## Architecture

### `src/ui/Dialog.tsx` — a new primitive

The modal shell: backdrop, `role`, `aria-modal`, Escape to close, focus trap,
focus restored to the opener on close. Presentation only, so it may import
nothing from `src/app/`, `src/data/` or `src/i18n/` — the `src/ui/` boundary
`sourceLint.test.ts` enforces.

`ConfirmDialog` is refactored to use it, which closes a defect the codebase
has already written down: its focus trap queries `'button'` specifically,
described in its own comments as harmless only because it holds exactly two
buttons. `Dialog` uses the wider `FOCUSABLE` selector `Popover` already
defines for the same reason.

`role` is a prop defaulting to `'dialog'`. `ConfirmDialog` keeps
`alertdialog`, which is not cosmetic: it is the role for a confirmation
guarding a destructive action, and this app's confirmations guard note
deletion.

### `src/features/appearance/ThemeDialog.tsx`

Replaces the popover list. A scrollable two-column grid of cards plus a
System card, each card:

- rendered inside `data-theme={id}` so it paints itself from the cascade,
  extending `ThemePicker`'s existing trick rather than replacing it;
- showing the theme name, two lines of sample prose, one bold run and one
  accent-coloured run — enough to judge a palette, which a swatch is not;
- carrying `role="radio"` inside a `radiogroup`, with `aria-checked`. The
  current picker uses `menuitemradio` inside a menu; a grid of previews is a
  radio group, not a menu.

The System card carries **no** `data-theme`, so it inherits whatever the
document currently shows — which is exactly what choosing System means, and is
the behaviour the current picker already relies on.

`ThemePicker` keeps its sidebar-footer trigger and its `Palette` glyph; only
what it opens changes.

### `src/styles/themes.ts`

`ThemeId` grows to sixteen. `group: 'light' | 'dark'` stays and stays
**hand-declared, not derived from luminance** — its existing comment records
why: `high-contrast` is dark by intent, and deriving the group would make the
picker's grouping a side effect of a colour edit.

## The contrast harness must be fixed first, and this is the sharp edge

`scripts/contrast.ts`'s `parseColour` handles `#hex` and `rgb()`/`rgba()`
only. Its fallback path strips an `rgb(` prefix and `Number()`s what is left.

Given `color(srgb 0.36 0.29 0.84 / 0.12)` — which is what **every derived
token** now computes to — that path produces `NaN`, and a contrast ratio
computed from `NaN` **can pass**. The one harness that exists to catch an
unreadable theme would go quietly blind at exactly the moment the roster grows
large enough to need it.

So `parseColour` learns `color(srgb …)` **before** any theme is derived, and
gains a test that fails against the current parser. This is the first task in
the plan, not a cleanup at the end.

Two further harness changes:

- `OVERLAYS` and the `READ` list already grew in E for the four highlight
  fills. They stay; the fills are now derived rather than literal, which is
  precisely why the parser fix has to land first.
- The suite iterates `THEME_IDS` read from the roster. Sixteen themes means
  sixteen Playwright tests where there were five. They run in parallel and
  each is a single `page.evaluate`, so this is cheap — but see the flake note
  below.

## Testing

**`scripts/sourceLint.test.ts` changes shape, and its guard must not weaken.**
Today it asserts every roster id has a block defining all 26 tokens. After F a
block defines about eight, so the assertion becomes: every roster id has a
block defining all **base** tokens, and `:root` defines every **derived**
token. Both directions still hold — a CSS block with no roster entry, and a
roster entry with no block, both still fail. The "finds themes in the roster
at all" floor stays, because a roster regex matching nothing would make every
assertion vacuous.

**The two `:root` agreement tests keep their jobs.** `:root` must still match
`DEFAULT_THEME_ID`'s block, and `:root:not([data-theme])` must still match
`SYSTEM_DARK_ID`'s — now over base tokens rather than all 26. The M2-era
hazard they guard is unchanged: a token right for someone who picked dark and
wrong for someone whose OS is dark.

**A regression test that the five existing themes are unchanged.** This is the
one test that makes the refactor safe to review. Every one of the 26 computed
tokens, for each of the five shipped themes, must resolve to the same colour
after derivation as before it — modulo format, since a derived token now
computes to `color(srgb …)` where it used to be `rgb()`. Comparison is by
parsed RGBA with a tolerance of one 8-bit step, not by string. Without this,
"derivation changed a colour slightly" is invisible.

**Contrast for all sixteen.** The existing floors, unchanged. This is the
gate that decides whether a palette ships faithful or adjusted.

**`npm run shots` covers five themes today** (12 shots × 5 themes = 60 files)
and its own comment records that the count is in the roster. At sixteen that
is 192 files. The shots entry point is not part of the six gates and is
gitignored, so this is a runtime cost rather than a repo cost — but the number
in CLAUDE.md must be corrected, and whoever runs it should expect it to take
three times as long.

**A note on the e2e suite's timing sensitivity.** E added five Playwright
tests and, in doing so, tipped three pre-existing timing-sensitive tests into
intermittent failure under machine load; all three were genuine races and were
fixed. F adds eleven more contrast tests. Expect the same class of thing, read
the failures rather than dismissing them, and check `uptime` before concluding
a diff broke the suite — CLAUDE.md now carries this.

## Out of scope

- **A custom-theme editor.** Letting a user supply their own seven colours is
  a natural follow-on once derivation exists, and is deliberately not F.
  Nothing here blocks it.
- **Per-theme editor syntax palettes.** Sub-project C (code block
  highlighting) will need them, and it is queued after F for exactly this
  reason: a code theme wants the palette generator to exist first, or it hand
  authors sixteen syntax palettes.
- **Theme sync.** The chosen theme is a local setting and stays one. D2 syncs
  notes and tags, not settings.
- **Changing the boot path.** `index.html`'s inline script, `applyTheme`,
  `readMirror` and `MIRROR_KEY` are untouched by F.

## Known limits

- **Sixteen themes is sixteen contrast surfaces to keep green forever.** Every
  future change to a derivation ratio is a change to fifteen themes at once.
  That is the trade being made: cheaper to add, broader to break.
- **A derived token cannot be inspected as a hex value in DevTools.** It shows
  as `color(srgb …)`. Anyone comparing against a palette's published hex will
  need to convert.
- **The two colour spaces are a standing hazard, not a settled detail.**
  `oklab` for opaque mixes and `srgb` for alpha tints is decided above and
  reasoned there, but nothing enforces it: a future token added in the wrong
  space compiles, renders, and looks subtly off in a way no test can see. The
  rule belongs in `design-tokens-and-layout.md`, not only here.
