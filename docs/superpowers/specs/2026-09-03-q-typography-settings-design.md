# Q — Typography settings

Written 2026-09-03, the day after N shipped. The second sub-project in a row
that came from the user hitting something in real use rather than from the
roadmap.

## Purpose

The user's words: *"the content area looks cramp. I really want to add
'setting' and line height, width, font-size. Just like bear."*

The editor renders every note at one fixed size, one fixed measure and one
fixed rhythm — `--bear-font-size: 16px`, `--bear-line-height: 1.6`,
`--bear-line-width: 40em` — and there is no way for a reader to move any of
them. Reading comfort is personal in a way a theme is not: sub-project P
improved the defaults for everyone and could not, by construction, fit anyone
in particular.

Q gives the reader five controls over the prose, applied live, persisted per
device, and carried into every export.

## What was measured before anything was decided

Four measurements, all taken on 2026-09-03 against `349c9f6`. Three of them
changed the design; one of them contradicts what `NEXT.md` told this
sub-project to do.

### 1. The eager closure has 146 B of headroom

A fresh `npm run build`, walked through `dist/.vite/manifest.json` the way
`scripts/bundleSize.test.ts` walks it:

| chunk           | gzipped   |
| --------------- | --------- |
| `themes-*`      | 233,998 B |
| `index-*`       |  62,768 B |
| `EmptyState-*`  |  39,552 B |
| `config-*`      |  11,536 B |
| **total**       | **347,854 B** |

Against the frozen 348,000 B ceiling that is **146 B**. Q does not fit in 146 B
under any shape.

### 2. A fourth `React.lazy` root makes the bundle WORSE by 322 B

`ThemeDialog` is a static import gated on `open`, so a typography dialog
written the same way is fully eager. The obvious escape hatch — write the panel
behind a lazy boundary — was measured rather than assumed, by converting
`ThemeDialog` itself to `React.lazy` and rebuilding:

| | base | `ThemeDialog` lazy |
| --- | --- | --- |
| eager chunks | 4 | 6 |
| eager closure | 347,854 B | **348,176 B** |

Rolldown re-hoists shared runtime into new eager chunks when a fourth lazy root
appears, and here that overhead exceeded the entire weight of the dialog being
deferred. This is the same effect sub-project M measured and recorded in
`scripts/bundleSize.test.ts` ("~330 B is Rolldown re-chunking, not a feature
cost at all"), reproduced independently. **Going lazier is not an option for
Q; it is a cost.** The spike was reverted.

### 3. `themes-*` is not the theme code — the chunk names are arbitrary

`NEXT.md` records that "`themes-*` at 232,910 B is the obvious candidate and is
its own sub-project". That reads a filename.

In the spike build of measurement 2 — which changed nothing but one import —
the same ~234 KB chunk came back named `notes-*`, and a **new 1,049 B chunk**
took the name `themes-*`. Rolldown names a chunk after some module inside it,
and which module wins is not stable across builds. The 1,049 B is the actual
theme roster plus the dialog; the 234 KB is Tiptap, ProseMirror, React and
lowlight wearing the name.

So splitting "themes" out of the eager closure would reclaim about 1,049 B and
pay 322 B of re-chunking to do it — except that measurement 2 shows the
re-chunking already exceeds the saving in practice, netting **about −322 B**.
It is not a bundle-reduction sub-project. It is a regression. That row in
`NEXT.md` is corrected as part of Q's first task.

### 4. The export already forwards all five typography tokens, and its headings are stale

`src/features/export/html.ts` lines 64–68 already list `--bear-font-size`,
`--bear-line-height`, `--bear-line-width`, `--bear-para-spacing` and
`--bear-para-indent` in `EXPORT_TOKEN_NAMES`, with fallbacks at lines 148–152,
and `exportNote.ts:153` resolves them with
`readExportTokens(doc.documentElement)`. Every one has a live consumer in the
export stylesheet. **So writing the five as inline custom properties on
`documentElement` gives HTML and server-rendered PDF parity for free**, with no
new export code at all. That is what makes Q cheap enough to be worth doing.

What is NOT forwarded is `--bear-heading-ratio` and `--bear-title-gap`, and the
divergence is worse than `NEXT.md` describes it. `NEXT.md` says the export's
"heading sizes are literals where the editor derives them from
`--bear-heading-ratio`". Measured, the literals are also **the wrong numbers**:

| | editor (`editor.css`) | export (`html.ts:578-580`) |
| --- | --- | --- |
| h1 | `ratio³` = 1.728em | 1.6em |
| h2 | `ratio²` = 1.44em | 1.35em |
| h3 | `ratio` = 1.2em | 1.15em |

`tokens.css:137`'s own comment on `--bear-heading-ratio` names 1.6 / 1.35 /
1.15 as *"the previous"* scale, replaced during M9a. The export kept the previous scale and nobody
noticed, because nothing compares the two. The export also has no title-line
treatment at all, where the editor gives a note's first block the accent, 700
weight, `ratio³` and a `--bear-title-gap` separator (`editor.css:218` and
`:238`).

Neither is visible in the four themes whose PDFs were pixel-verified. Both get
worse the moment the reader controls the type, which is why Q closes them
rather than widening them.

## Decisions

### The ceiling moves to 351,000 B, decided by the user on 2026-09-03

The frozen ceiling names four exits for a feature that does not fit: go lazier,
move to the server, cut it, or put it to the user. Measurement 2 closes the
first — lazier is negative here. A per-device reading preference has nothing to
move to a server, and the sync engine deliberately does not carry the
`settings` table, so the second is closed too. Cutting Q means not doing the
thing that was asked for.

That leaves the fourth, and the user took it: **`CEILING_BYTES` moves to
351,000**, leaving Q **3,146 B**. Recorded in `scripts/bundleSize.test.ts`'s
docblock with measurements 1–3 as the reason. This does not reopen routine
ratcheting, under exactly the same rule as every raise before it. Q is measured
on both sides; **if the finished closure lands well under 351,000, the ceiling
comes down to the real figure plus ~3 KB rather than staying at the ask.**

### A typography panel, not a Settings surface

One modal, opened from a new button in the sidebar footer beside the palette
icon. The preferences currently scattered across menus — sort order, preview
size, hide-sub-tag-notes, theme — stay where they are. They are already
reachable in the context where they are used, and gathering them into a tabbed
Settings dialog is a UX argument to have on its own merits, not a side effect
of wanting bigger type. A tabbed surface would also cost i18n keys against a
ceiling that was just raised for something else.

### The five already-wired tokens, plus Reset

Font size, line height, line width, paragraph spacing, paragraph indent. Every
one has a consumer in `editor.css` AND in the export stylesheet today, so the
feature is a panel plus an applier and no new CSS plumbing.

Heading scale and font family are deliberately out. Exposing
`--bear-heading-ratio` means resolving the export divergence *and* designing a
control for a ratio, and a font-family control means either offering bare
system stacks or bundling more webfonts. Both are real design decisions rather
than extra rows.

### Native `<input type="range">`, not a custom control

Bear's own shape, and the cheapest one here in three separate senses. It is
keyboard-driven and screen-reader-labelled for free. It is testable in jsdom
via `fireEvent.change` and in Playwright via `fill()` — where a custom drag
control would be Playwright-only, since jsdom has no `setPointerCapture`. And
it needs no drag state machine, which matters against a 3,146 B budget.

### One settings key holding one object

`'typography'`, holding `{ fontSize, lineHeight, lineWidth, paraSpacing,
paraIndent }`. Not five keys: five keys means five live queries, five
optimistic slots, and a Reset that issues five racing writes. One object means
one guard, one write, and Reset is a single `set(DEFAULTS)`.

### `useTheme`'s shape, not `useSetting`'s — because of the mirror

`NEXT.md` records the persistence decision as "per-device via `useSetting`".
Per-device is right and stands. `useSetting` is the wrong hook, and the reason
is the paint-time flash.

`useSetting` renders at its fallback until IndexedDB answers — its docblock
states this outright: *"one frame at the default beats a blank pane."* For sort
order that frame is invisible. For font size and line width it is the whole
note reflowing on every launch. The theme already solved exactly this with a
`localStorage` mirror read by an inline script before first paint, and
`useTheme` is the hook shaped around that: it seeds its live query **from the
mirror** rather than from a constant, precisely so the app cannot disagree with
the frame it already painted.

Typography needs the same mirror, so it gets the same shape. It also inherits
the reason `useTheme` can skip `useFlushTriggers` where `useSetting` cannot:
the mirror is written synchronously, so a reload landing between the change and
the fire-and-forget durable write still reads the user's value.

One difference from `useTheme` is repaired rather than copied. If `useTheme`'s
durable row is missing but the mirror is present, `get` falls back to the
mirror and nothing ever rewrites the row — the mirror carries the preference
indefinitely and clearing site data loses it silently. `useTypography` writes
the durable row on boot when it differs from the resolved value, so the mirror
is a cache rather than a second source of truth.

### The panel owns the drag; React does not

A slider fires a change on every tick. Routing each tick through a durable
write and a `useLiveQuery` would re-render `AppShell` thirty times during one
drag, which is both janky and pointless.

So: the panel holds the in-flight value in local state and writes the custom
property onto `documentElement` **imperatively** on every tick, giving live
feedback with no React state above the panel. The mirror and the durable row
are written on a trailing debounce (250 ms), which covers mouse, keyboard and
touch with one mechanism instead of three handlers. The `useTypography` hook
therefore matters at boot and on Reset, not during a drag.

## The controls

| Token | Label | Range | Step | Default |
| --- | --- | --- | --- | --- |
| `--bear-font-size` | Font size | 13–22 px | 1 | 16px |
| `--bear-line-height` | Line height | 1.3–2.0 | 0.05 | 1.6 |
| `--bear-line-width` | Line width | 30–70 em | 2 | 40em |
| `--bear-para-spacing` | Paragraph spacing | 0–1.5 em | 0.25 | 0em |
| `--bear-para-indent` | Paragraph indent | 0–3 em | 0.5 | 0em |

Every default is the token's current value, so a fresh install renders exactly
as it does today.

**The line-width range extends well above 40em on purpose.** 40em was measured
off the real Bear during M8 and it is the number the "cramped" report is
about — at 16px it is a 640px column inside an 840px pane, so a third of the
editor is margin. `editor.css:94` is `max-width: min(var(--bear-line-width),
100% - 3rem)`, so a wide setting degrades safely on a narrow pane and on a
phone rather than overflowing.

The font-size floor is 13px because the app chrome is 14px and prose smaller
than its own furniture reads as broken; the ceiling is 22px because above that
the default measure exceeds a typical pane and the clamp takes over, making the
control appear to stop working.

## Architecture

### Files

| Path | Change |
| --- | --- |
| `src/app/typography.ts` | new — `Typography`, `DEFAULTS`, `BOUNDS`, `isTypography`, `applyTypography`, `readTypographyMirror`, `writeTypographyMirror`, `TYPOGRAPHY_KEY`, `TYPOGRAPHY_MIRROR_KEY`. The direct analogue of `src/app/theme.ts`. |
| `src/app/useTypography.ts` | new — the analogue of `useTheme.ts`: seeds from the mirror, applies on boot, heals a missing durable row, exposes `set` and `reset`. |
| `src/features/typography/TypographyPanel.tsx` | new — the modal: five labelled ranges with live readouts, and Reset. |
| `src/features/typography/TypographyButton.tsx` | new — the sidebar-footer trigger, a sibling of `ThemePicker` in the same sense `AccountMenu` is. |
| `src/features/typography/index.ts` | new — the feature barrel. |
| `src/app/SidebarContent.tsx` | mount the trigger beside `ThemePicker`. |
| `index.html` | extend the pre-paint inline script to read the typography mirror. |
| `src/i18n/en.ts`, `ko.ts` | ~11 keys. |
| `src/features/export/html.ts` | the two divergences — see below. |
| `scripts/sourceLint.test.ts` | a `describe` for the typography half of the pre-paint script. |
| `scripts/bundleSize.test.ts` | the ceiling raise and its reasoning. |
| `docs/rulings/design-tokens-and-layout.md`, `docs/rulings/export.md` | the rulings Q creates. |
| `docs/superpowers/NEXT.md` | correct the `themes-*` row. |

`src/features/typography/` is a new feature directory rather than an addition
to `src/features/appearance/`. Appearance is about colour and owns the
sixteen-card roster; typography is about type and shares none of it. Keeping
them apart also keeps `ThemeDialog`'s file — already 5.6 KB of reasoning —
from growing a second unrelated concern.

### Data flow

```
index.html inline script          (before first paint)
  localStorage 'bear-web:typography' -> validate -> documentElement.style

useTypography()                    (boot, and on Reset)
  useLiveQuery(settings.get('typography', readMirror()))
    -> isTypography() guard, else DEFAULTS
    -> applyTypography(documentElement)
    -> writeMirror(); heal the durable row if absent

TypographyPanel                    (during a drag)
  onChange -> local state -> documentElement.style.setProperty  [every tick]
           -> debounce 250ms -> writeMirror() + settings.set()  [trailing]

editor.css                         reads the five tokens (already)
html.ts readExportTokens()         reads the five tokens (already)
```

Three writers touch `documentElement.style`, and they cannot conflict: the
inline script runs once before React exists, `useTypography` runs on boot and
on Reset, and the panel runs only while it is open.

### The guard, and why it is not optional

`isTypography` validates five finite numbers, each inside its declared bound,
and anything else falls back to `DEFAULTS`. `useSetting`'s docblock records why
this matters generally — a row written by a future version or edited by hand in
devtools must not reach a consumer that cannot handle it. Here the consumer is
CSS, and the failure is worse than undefined behaviour: `--bear-font-size:
NaN` or a hand-edited `0` renders an unreadable note with no error anywhere,
which is the same silent shape as `parseColour`'s `NaN` and the unmapped
`.hljs-*` class.

The inline script validates independently, in ES5, against bounds duplicated
from `typography.ts` — a module import would be async and defeat the point,
exactly as the theme roster is duplicated there today. `sourceLint.test.ts`
asserts the two lists of bounds agree, the same way it asserts the theme roster
agrees.

## Closing the two export divergences

Both are in `src/features/export/html.ts`, and both are corrections rather than
features.

1. `--bear-heading-ratio` and `--bear-title-gap` join `EXPORT_TOKEN_NAMES` with
   fallbacks `'1.2'` and `'1.75em'`.
2. The export's `h1`/`h2`/`h3` rules derive from the ratio the way
   `editor.css:251-264` does, replacing `1.6em` / `1.35em` / `1.15em` — which
   are the pre-M9a numbers and are wrong today, before Q changes anything.
3. The export gains the title-line treatment: `body > :is(p, h1..h6):first-child`
   at `ratio³`, accent, 700 weight, `line-height: 1.25`,
   `letter-spacing: -0.02em`, and the `--bear-title-gap` separator on the
   following sibling. Specificity is (0,2,0) against the heading rule's
   (0,1,1), the same arrangement `editor.css` relies on.

**These rules ship with almost no comments.** Sub-project P measured that CSS
comments are real bytes in the eager chunk AND in every exported file — its
first draft cost 960 B, almost entirely comments — and the export stylesheet
already carries a note saying its reasoning lives in `docs/rulings/export.md`
for that reason. The reasoning above goes in that ruling; the stylesheet gets
one line pointing at it.

## Accessibility

Each range is labelled by a real `<label>` and reports its value through
`aria-valuetext` with the unit, since a bare `1.6` is meaningless read aloud.
The readout beside each label is `aria-hidden`, because the value is already in
the accessible name and announcing it twice is noise. The modal reuses
`src/ui/Dialog.tsx`, which supplies the backdrop, the focus trap, Escape and
focus restoration. Reset is a `Button`, and it is not disabled when the values
are already default — a disabled control that a user reaches for and cannot
press explains nothing.

`docs/rulings/accessibility.md` gets a row.

## Testing

### What the gates can see

- **Component (`TypographyPanel.test.tsx`)** — five ranges render with their
  labels, bounds and steps; changing one writes the matching custom property
  onto `documentElement`; Reset restores all five and writes them; the panel
  opens focused and Escape closes it.
- **Unit (`typography.test.ts`)** — `isTypography` accepts the defaults and
  rejects each malformed shape (missing key, non-finite, out of bounds, wrong
  type, a value from a hypothetical future version); `applyTypography` writes
  exactly five properties and no others; the mirror round-trips and a corrupt
  mirror degrades to `DEFAULTS` rather than throwing.
- **`useTypography.test.ts`** — seeds from the mirror; a durable row wins over
  the mirror on boot; an absent durable row is healed.
- **`scripts/sourceLint.test.ts`** — the inline script reads the same key the
  app writes, runs before `/src/main.tsx`, and its duplicated bounds match
  `typography.ts`.
- **e2e (`typography.spec.ts`)** — choose a size, reload, and assert both that
  the value survives and that **no frame painted at the default**, using the
  `addInitScript` observer that watches for `<body>` appearing rather than
  touching `document.documentElement` at `document_start`, which is null then.
  Then export the note and assert the exported HTML carries the chosen
  `--bear-font-size` and `--bear-line-width`.
- **`npm run measure:check` must pass UNCHANGED.** Q's defaults are today's
  values, so no measured surface may move. If `measurements.md` moves, a
  reading preference has leaked into the app chrome — which is the one
  regression this feature can cause and the one an existing gate can already
  see. This is stated as an assertion, not as a chore.

Every test above is injured to prove it can fail before it is trusted. The
near-vacuous shapes `CLAUDE.md` warns about apply directly here: asserting that
a custom property is *present* proves nothing, so each assertion names a value
distinct from the default.

### What no gate can see

Whether the result actually reads better, and whether any combination of the
five produces something ugly. `npm run shots` is run at the defaults, which
must be pixel-identical to today, and the panel is exercised by hand across the
range at three pane widths and on a phone viewport. **The app is run**, not
just tested — N shipped a circular import that passed all six gates and three
reviews and left the app rendering nothing.

## Byte budget

347,854 B measured at `349c9f6`, against the new 351,000 B ceiling: **3,146 B**
for the panel, the trigger, two hooks, the applier, the guard and ~11 i18n keys
in two locales.

Two things are outside the guard's scope and are stated so they are not
mistaken for free. The inline script grows `index.html`, which is first-load
bytes the guard does not measure. The new export CSS ships in the eager chunk
*and* in every exported file — see the comment rule above.

Precedent for the estimate: M's comparable wiring (9 i18n keys, a menu item and
shell plumbing, with the dialog itself lazy) measured ~350 B of first-party
code. Q's panel is not lazy and is larger, so the working expectation is
1.5–2.5 KB. Both sides get measured; the number that matters is the one
`npm run build` produces at the end.

## Out of scope

- Cross-device sync of typography. The sync engine's transaction list is
  notes/noteTags/noteLinks/files/noteFolds/syncState and deliberately excludes
  `settings`; carrying preferences would need a server change, and it was
  explicitly declined.
- Heading scale and font family as controls.
- Per-note typography. These are reader preferences, not document properties.
- A 17th entry in the `npm run shots` roster for this dialog. 256 files is
  already at the edge of what a person can review, and the panel is chrome that
  every theme renders identically.
- Gathering the other preferences into a Settings surface.

## Open questions

None. The ceiling, the surface, the control set and the control shape were all
decided before this spec was written.
