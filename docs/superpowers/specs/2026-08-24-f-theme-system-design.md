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

1. **Gives a new theme sensible derived defaults**, so a new theme block is
   about eight declarations rather than twenty-six. It does not re-derive the
   existing five; see below for the measurement that ruled that out.
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

### The derived split — and what measurement disproved

The first draft of this section claimed `muted`, `faint` and `border` were
`text` mixed toward `bg` at a near-constant ratio, and derived them. **That is
wrong, and the plan was written only after checking it.** Recorded here rather
than quietly dropped, because the wrong version is convincing:

| theme        | muted (sRGB / oklab) | faint         | border        |
| ------------ | -------------------- | ------------- | ------------- |
| paper        | 66.6% / 62.0%        | 54.2% / 49.3% | 13.0% / 11.1% |
| indigo-light | 71.8% / 69.4%        | 55.6% / 53.2% | 13.2% / 13.2% |
| indigo-dark  | 68.1% / 69.6%        | 50.5% / 52.7% | 11.3% / 12.9% |
| ink          | 62.4% / 66.4%        | 44.2% / 48.9% | 11.9% / 14.6% |

The *lightness* fits a constant ratio well, which is what made the theory look
right. The **chroma does not**. `indigo-dark`'s `muted` is `(169, 163, 189)` —
visibly violet — where a `text`→`bg` mix at the fitted ratio gives
`(165, 162, 173)`, a near-grey. Reproducing all four themes at any single
ratio is off by up to 17/255 per channel. These are hand-tuned tinted greys,
not mixes.

The same check on the alpha tokens:

- **`focus` is exactly `accent` in all five themes.** Genuinely derivable.
- **`selected`, `tag-fill` and `tag-fill-strong` are exactly `accent`** at an
  alpha — the colour derives perfectly, but the alphas are hand-tuned
  (`selected` is .09, .11, .18, .20 across four themes) and their ratios to
  one another are not constant either.
- **`hover` has no single base.** It is `text` in `paper`, plain white in both
  dark themes, and a third colour close to but not equal to `text` in
  `indigo-light`.

**So derivation does not reproduce the shipped themes, and this spec no longer
claims it does.** What it provides is *defaults for new themes*:

- **`:root` derives sensible defaults** for `muted`, `faint`, `border`,
  `hover`, `selected`, `tag-fill`, `tag-fill-strong`, the four highlight
  fills, and `focus`.
- **The five existing themes keep every hand-tuned value explicitly** and
  therefore render byte-identically. That guarantee now holds trivially: they
  override, so nothing about them changes.
- **The eleven new themes take the defaults**, and override only where the
  contrast harness objects.

A new theme is therefore about eight declarations; the existing five stay
roughly as long as they are today. The win is entirely in what F adds, which
is the right place for it — and it is a real win, because eleven themes at
eight values is eighty-eight decisions instead of two hundred and eighty-six.

**Chosen per new theme (7 + 1):** `bg`, `surface`, `sidebar`, `canvas`,
`text`, `accent`, `danger`, `shadow`.

**Derived in `:root` (12):**

```
/* opaque mixes, in oklab: perceptually even, so one ratio serves every palette */
muted           = color-mix(in oklab, text 68%, bg)
faint           = color-mix(in oklab, text 51%, bg)
border          = color-mix(in oklab, text 13%, bg)
focus           = accent

/* alpha tints, in srgb: mixing with transparent in oklab shifts hue as it fades */
hover           = color-mix(in srgb, text   calc(var(--bear-hover-a) * 100%), transparent)
selected        = color-mix(in srgb, accent calc(var(--bear-tint) * 100%), transparent)
tag-fill        = color-mix(in srgb, accent calc(var(--bear-tint-mid) * 100%), transparent)
tag-fill-strong = color-mix(in srgb, accent calc(var(--bear-tint-strong) * 100%), transparent)
hl-blue|green|pink|purple = color-mix(in srgb, <fixed hue> calc(var(--bear-hl-a) * 100%), transparent)
```

**Two colour spaces, deliberately.** The opaque mixes use `oklab` because
perceptual evenness is why one ratio can serve sixteen palettes: an sRGB
midpoint lands visibly darker in some hues than others. The alpha tints use
`srgb`, because mixing a colour with `transparent` in `oklab` interpolates
through a premultiplied space and shifts hue as it fades, which is not the
plain alpha these tokens have always been. Do not "tidy" the two into one.

### One scalar per theme, not five

The five alpha scalars (`--bear-tint`, `--bear-tint-mid`,
`--bear-tint-strong`, `--bear-hover-a`, `--bear-hl-a`) differ only between
light and dark. Rather than repeating five declarations in every dark theme,
each theme declares a single **`--bear-dark: 0` or `1`** and `:root`
interpolates:

```
--bear-tint:        calc(0.10 + 0.09 * var(--bear-dark));
--bear-tint-mid:    calc(0.13 + 0.08 * var(--bear-dark));
--bear-tint-strong: calc(0.28 + 0.07 * var(--bear-dark));
--bear-hover-a:     calc(0.05 + 0.01 * var(--bear-dark));
--bear-hl-a:        calc(0.20 + 0.08 * var(--bear-dark));
```

The endpoints are the measured light and dark medians. `--bear-dark` is a
number, not a keyword, precisely so `calc()` can use it — and it is
independent of `themes.ts`'s `group`, which stays hand-declared for the
picker. A theme wanting a value between the two can say `0.5`, which no
grouped selector could express.

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
Today it asserts every roster id has a block defining all 26 tokens. That
assertion cannot survive: a new theme block defines eight and inherits the
rest. It becomes two assertions that together are strictly stronger than one
weakened one:

1. Every roster id has a block defining all eight **base** tokens
   (`bg`, `surface`, `sidebar`, `canvas`, `text`, `accent`, `danger`,
   `shadow`) plus `--bear-dark`.
2. **`:root` defines all 26**, so every token a component consumes resolves
   for every theme whether or not that theme declares it.

Both directions of the roster/CSS agreement still hold: a CSS block with no
roster entry, and a roster entry with no block, both still fail. The "finds
themes in the roster at all" floor stays, because a roster regex matching
nothing would make every assertion vacuous.

**The `:root` agreement tests narrow to base tokens, and this is a real loss
of coverage that must be stated.** `:root` must still match
`DEFAULT_THEME_ID`'s block and `:root:not([data-theme])` must still match
`SYSTEM_DARK_ID`'s — but only over the tokens the theme actually declares,
because `:root` now legitimately holds derived values the theme block does
not repeat. The M2-era hazard they guard (a token right for someone who
picked dark and wrong for someone whose OS is dark) is still covered for
every declared token, which is where it can actually occur.

**A regression test that the five existing themes are unchanged.** This is the
one test that makes the refactor safe to review, and it is a *computed-value*
test, so it belongs in Playwright rather than in the source lint. Every one of
the 26 computed tokens, for each of the five shipped themes, must resolve to
the same colour after the refactor as before it. Comparison is by parsed RGBA
against a fixture captured from `main` **before** any derivation lands, with a
tolerance of one 8-bit step — not by string, because a value that used to read
`rgb(…)` may now read `color(srgb …)` while denoting the same colour.

Capturing that fixture is therefore task two, before the refactor, and the
plan orders it that way. Without it, "derivation changed a colour slightly" is
invisible — and the measurement above proves that is not a hypothetical: a
plausible-looking derivation was off by up to 17/255 per channel.

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
