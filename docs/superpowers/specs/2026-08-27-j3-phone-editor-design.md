# J3 — The editor on a phone

**Date:** 2026-08-27
**Status:** approved, unimplemented
**Depends on:** J1 (responsive shell), J2 (touch parity)
**Does not block:** anything. J4 depends on J1, not on this.

## The problem

J1 made the phone build usable and J2 made every affordance reachable by a
finger. Neither touched how the editor is LAID OUT at 390px, which is where the
remaining defects are. Measured at 390x844 on 2026-08-27:

| Problem | Evidence |
| --- | --- |
| Tables squeeze instead of scrolling | four columns into 278px renders `colum` / `n one` and `gamm` / `a` — breaking mid-word |
| `BottomToolbar` clipped at the right edge | a 350px strip with no scroll affordance, and still 28px targets inherited from J2 |
| The virtual keyboard is entirely unhandled | no `visualViewport` reference anywhere under `src/`; the toolbar sits at y=788 and an iPhone keyboard covers roughly the bottom 336px |
| `100vh` in three menu clamps | `NoteRowMenu.tsx:156`, `EditorContextMenu.tsx:136`, `useAnchoredMenu.ts` — the LARGE viewport on mobile, so a tall menu can run past the bottom of the screen |
| The viewport meta is the bare default | `width=device-width, initial-scale=1.0`, no `interactive-widget` |

**The keyboard is the one that actually breaks the app**: the formatting toolbar
is hidden at exactly the moment the user is typing.

### One item in `NEXT.md` is stale and is NOT implemented against

`NEXT.md` names "the top control pill overlapping the note title at 390px" as
J3's first item. It does not overlap. Measured with both a wrapping and a short
title: the pill's bottom edge is at y=112 and the title's top is at y=112,
because `.ProseMirror`'s `pt-12` reserves exactly the pill's height. Flush, with
no overlap and no gap. `NEXT.md` is corrected rather than built against.

## What J3 is, and where it stops

**J2 owned reachability; J3 owns layout.** One test separates them: _can a
finger reach it_ versus _does it fit_. That line was drawn in J2's spec and is
unchanged here.

## Decisions

### 1. The keyboard: the browser first, JavaScript second

`index.html`'s viewport meta gains `interactive-widget=resizes-content`. Where
it is honoured the BROWSER shrinks the layout viewport when the keyboard opens,
and the absolutely-positioned toolbar stays above it with no JavaScript at all.

`src/lib/useVisibleViewport.ts` covers everywhere else. It returns one number —
how many pixels at the bottom of the window are hidden:

```
inset = max(0, window.innerHeight - (visualViewport.height + visualViewport.offsetTop))
```

`RichEditor` applies that inset to the bottom toolbar's positioning wrapper and
to nothing else.

**The property that makes two mechanisms safe is arithmetic, not detection.**
When `interactive-widget` has already done the work the layout viewport shrank
too, so `innerHeight` and `visualViewport.height` agree and the inset is
naturally 0. The fallback cannot double-apply because there is nothing left to
correct. Feature-detecting `interactive-widget` support would be the fragile
version of this, and there is no reliable way to detect it anyway.

`visualViewport` may be absent. That path returns 0 and is a real browser rather
than a hypothetical, so it is unit-tested rather than assumed away.

### 2. The toolbar grows; the clipping problem dissolves

The strip and its buttons reach 44px on a coarse pointer, keeping the horizontal
scroll and gaining an edge fade so it is visible that more exists — today it is
clipped with no hint at all.

**This deletes J2's inherited gap rather than working around it.** J2 could not
give `BottomToolbar` a hit area because the strip is `overflow-x-auto`, which
forces a non-visible `overflow-y` and clips a 44px `::after` to the 36px strip.
Once the INK is 44px that blocker is moot: the strip needs no hit-area utility
at all, and `BottomToolbar`'s "NO `touch-target-y` here" comment comes out along
with the ruling bullet that recorded the deferral.

A single scrolling row is chosen over two rows and over an overflow menu. Twelve
actions plus two chevrons at 44px is about 616px, so nothing fits 390px in one
row whatever is done. Two rows would cost ~88px — about 18% of the ~500px left
once the keyboard is open, competing with the prose for exactly the space the
writer needs. An overflow menu hides half the toolbar behind a second tap and a
judgement about which six actions matter.

`RichEditor`'s bottom reserve becomes coarse-aware, because
`e2e/appearance.spec.ts` measures the toolbar's reach into the pane and asserts
the reserve covers it. That test runs at 1280 with no `hasTouch`, so gating the
growth on `(pointer: coarse)` leaves it untouched — but it gains a
phone-viewport sibling, since an uncovered reserve is exactly the "pill overlaps
text" defect it exists to catch.

### 3. Tables scroll, at every width

`.tableWrapper` gets `overflow-x: auto` and the table a `min-width` derived from
its column count, so columns stop dividing the pane equally. The cause today is
`editor.css`'s `width: 100%; table-layout: fixed`, which gives four columns
about 69px each regardless of content.

Applied at EVERY width, not only below the tablet breakpoint. A four-column
table in a narrow desktop pane squeezes exactly the same way, and a table that
scrolls on a phone but squeezes on a laptop is two behaviours to hold in the
head.

**This spec predicted reference-set churn here and was wrong.** Running
`npm run measure` on `main` and on the implemented branch produces
byte-identical output. A four-column table needs 512px and the measured desktop
pane is 592, so it never scrolls there — and `measure` has no table surface at
all, only a code block. `measurements.md` WAS stale, by three days and three
unrelated sub-projects, and was regenerated in its own commit rather than
inside J3's.

`TableHandles` re-measures on the wrapper's scroll. It positions against
`table.getBoundingClientRect()`, so without this the column handles drift out of
alignment the moment a user scrolls the table — a consequence J2's resting
handles created for J3. The re-measure goes through `requestAnimationFrame`,
reusing the plugin's existing `measure`, because a scroll fires far more often
than a transaction.

### 4. `100vh` becomes `100dvh` in the three menu clamps

`100vh` on mobile is the LARGE viewport and ignores browser chrome, so a tall
menu can extend past the bottom of the screen. This is the three menu height
clamps only — the app shell's own height is J4.

## Testing

`e2e/fixtures/fakeViewport.ts` installs a controllable `visualViewport` through
an `addInitScript` (before boot, for the reason `seedDatabase` runs there) using
`Object.defineProperty`, and exposes `__setKeyboardInset(px)` which adjusts the
fake's `height`/`offsetTop` and dispatches `resize`. The suite then drives the
same code path a real keyboard drives.

- **Unit:** `useVisibleViewport`'s arithmetic — the clamp at 0, `offsetTop`
  handling, the absent-`visualViewport` path, and listener cleanup.
- **e2e at 390 with `hasTouch`:** the toolbar rises by exactly the inset and
  returns when the keyboard closes; toolbar buttons measure at least 44 (the INK
  now, so a plain `boundingBox` is the honest assertion rather than an assertion
  about a pseudo-element); `.tableWrapper` reports `scrollWidth > clientWidth`
  and a cell holds a minimum width; scrolling the table and asserting a COLUMN
  HANDLE REALIGNS, which changes with the behaviour rather than confirming a
  rect exists; a menu opened near the bottom edge stays inside the visible
  viewport.
- The reserve assertion gains a phone-viewport sibling.
- Every rule is sabotaged once and shown red before it is trusted.

### The limit of all that, stated plainly

**These tests would stay green if `interactive-widget=resizes-content` were
misspelled.** They prove the FALLBACK works. They cannot prove the browser path
does, because Playwright has no virtual keyboard and, on iOS, the keyboard
shrinks `visualViewport.height` without changing `window.innerHeight` — which is
precisely the distinction that matters. A source assertion that the meta tag
contains the token catches deletion and nothing more; it cannot catch "the
browser ignored it".

### The real-device checklist

Run once and record the result. This is the `useSession` StrictMode lesson: no
gate can see this class of bug, and running the app can.

1. Open a note, tap into the prose. The keyboard opens and the formatting
   toolbar sits directly above it, not under it.
2. Dismiss the keyboard. The toolbar returns to the pane's bottom.
3. Rotate with the keyboard open. The toolbar tracks.
4. Scroll the prose with the keyboard open. The toolbar stays put.
5. Tap a table and swipe it sideways. The column handles stay on their columns.
6. Open a row menu near the bottom edge. It stays on screen.

**Item 1 on ANDROID is the only thing that can prove the two mechanisms do not
double-apply**, because Android honours `interactive-widget` and iOS may not.

## Non-goals

- **Selection handles.** `NEXT.md` lists them among J3's items. The OS draws
  them and there is nothing to build. Recorded here with that reason rather than
  dropped silently.
- **The code-language popover.** Scoped as a PLACEMENT CHECK during
  implementation, not a redesign: the survey above did not cover it. If it
  measures broken at 390px it gets a placement fix; if it does not, it gets
  nothing.
- **Safe-area insets, `100dvh` on the app shell, installability,
  pull-to-refresh** — J4. The `100dvh` change here is three menu clamps only.
- **The top pill overlapping the title.** Measured as already correct; see
  above.
- **Two-row or overflow-menu toolbars.** Considered and rejected in decision 2.

## Corrections made while building

Recorded here rather than silently fixed, because each one is a thing this spec
asserted and the code disproved.

- **Three plausible ways to floor a column's width do nothing**, and all three
  were measured rather than reasoned about. `min-width` on `td`/`th` is IGNORED
  under `table-layout: fixed` and renders byte-identically to no rule at all;
  `min-width` on the table loses to Tiptap's own inline `min-width: 50px`;
  `min-width` on `col` loses to its inline `min-width: 25px`. Only
  `col { min-width: … !important }` works — outranking a third-party inline
  style, which is the one case the keyword exists for. An earlier draft of this
  spec proposed a `--bear-table-columns` variable set from `TableHandles`, which
  would have been worse than wrong: that plugin only mounts while the caret is
  inside the table, so every other table on screen would have fallen back and
  squeezed.
- **`coarse:pb-32` was written, could not be falsified, and was removed.** The
  grown strip reaches 68px into the pane against `pb-24`'s 96, so the reserve
  needed no change. The guard was itself verified by overgrowing the strip to
  `h-32`, where it fails at 96 < 140.
- **The reference-set churn this spec predicted does not exist.** See decision 3.
- **`useAnchoredMenu`'s flip decision needed the same fix as the clamps.** It
  asked `window.innerHeight` whether a menu "fits below", which on iOS reports a
  full screen while a third of it is under a keyboard. It now asks
  `visibleBottom()`. The spec scoped only the three `maxHeight` clamps.

## Findings for whoever does J4

- **A `poll`-based assertion can hide a missing listener entirely.** The
  handle-drift test polled for five seconds; any unrelated ProseMirror view
  update in that window re-measures the layer, so the test passed with the
  scroll listener deleted. It now scrolls and measures in ONE round trip two
  frames later — what a user sees during a fling — and fails at exactly 120px.
- **The table handle layer is a SIBLING of the scroll container, not a child.**
  Verified in the DOM rather than inferred: `wrapper.contains(layer) === false`.
  So it neither moves with the cells nor gets clipped by the wrapper, which is
  why row handles pin to the visible left edge and column handles hide by
  `visibility` when their column scrolls away.
