# J2 — Touch parity

**Date:** 2026-08-27
**Status:** approved, unimplemented
**Depends on:** J1 (responsive shell), J2a (phone header proportions)
**Does not block:** anything. J3 and J4 depend on J1, not on this.

## The problem

J1 turned the phone build from unusable into usable. It did not make it
_reachable_. Six affordances in the shipped app are revealed by hover or opened
by right-click, and a phone has neither:

| Affordance | Route today | Where |
| --- | --- | --- |
| Note row pin | `opacity-0 group-hover:opacity-100` | `src/features/notes/NoteListItem.tsx:250` |
| Note row menu (Pin, Duplicate, Copy text, Export, Delete) | `contextmenu` / `Shift+F10` | `NoteListItem.tsx:120,135` |
| Heading fold chevron + level badge → `HeadingMenu` | heading `:hover` | `src/styles/editor.css:687` |
| Table edge handles → `TableHandleMenu` | table `:hover` | `editor.css:788` |
| Stored-image resize grip | image `:hover` | `editor.css:996` |
| Editor context menu | `contextmenu` | `src/features/editor/ContextMenu.ts:135` |

Separately, J2a raised the phone _header_ to 44px targets and stopped there.
`BottomToolbar` is `h-9` with `h-7` buttons, the row pin is `p-1` around a 12px
glyph, and every menu item is `py-1` (~26px).

Nothing under `src/features/editor/` or `NoteListItem.tsx` reads the layout mode
at all, and `src/styles/` contains no pointer or hover media query — the only
`@media` blocks are `prefers-color-scheme` and `prefers-reduced-motion`.

## What J2 is, and where it stops

**J2 owns reachability. J3 owns layout.** One test separates them: _can a finger
reach it_ versus _does it fit_. Making a resting chevron appear is J2. Deciding
where the toolbar sits when the virtual keyboard opens is J3.

`docs/superpowers/NEXT.md` listed table affordances under both J2 and J3. This
spec resolves that: the table _handles_ become reachable here; whether a table
scrolls or reflows at 390px is J3.

## Decisions

### 1. Hybrid: visible in the editor, long-press in the list

Editor-gutter controls render **at rest** on a touch device. Long-press is not
an option there: inside a `contenteditable` the OS already owns that gesture for
select-word-and-callout, and a hand-rolled timer competing with it is a fight
the app cannot win — iOS Safari does not even fire `contextmenu` on long-press,
so it would have to be reimplemented from `pointer` events over the top of the
platform's own selection UI.

The note-list row is not editable, so nothing claims the gesture there.
Long-press opens the row menu, which is what a phone user already expects from a
list.

### 2. Two queries, each testing its own thing

`(hover: none)` gates **reveals**. It is the literal statement "this control can
never be revealed", which is the defect.

`(pointer: coarse)` gates **target size** and **long-press**. It is the literal
statement "the pointer is a fingertip".

They differ only on rare hardware (stylus-only panels, TV remotes), and the
point is not the coverage — it is that each rule reads as the reason it exists.

Verified in Chromium on 2026-08-27 with a throwaway probe: a Playwright context
with `hasTouch: true` flips both, with or without `isMobile`.

```
desktop default    hoverNone:false hoverHover:true  coarse:false fine:true
hasTouch only      hoverNone:true  hoverHover:false coarse:true  fine:false
hasTouch+isMobile  hoverNone:true  hoverHover:false coarse:true  fine:false
```

This matters because it is the whole reason J2 is testable. If it had come back
false, the design would have had to route detection through something Playwright
_can_ emulate.

### 3. The editor context menu gets NO touch route

Every action it carries — heading levels, bold, italic, strike, link, the
highlight palette, lists, code, quote, table operations — is reachable from
`BottomToolbar`, and the table operations are additionally reachable from
`TableHandleMenu`, whose handles rest visible under decision 1.

So on touch it is a second route to capabilities that already have one, not a
pointer-only capability. `docs/rulings/accessibility.md` calls a pointer-only
route to a real capability a regression; this is not one.

The OS keeps its own long-press callout — Cut, Copy, Paste, Look Up, Share —
intact inside the editor, which is what a phone user actually wants there.

**This is a deliberate non-goal with an audit behind it, not an omission.** If a
future action is added to `EditorContextMenu` without a `BottomToolbar` twin,
this decision lapses and must be revisited.

### 4. The row pin rests visible AND long-press opens the menu

Sub-project I hid the resting pin on the grounds that "the row menu is another
route to pinning". On touch that route is invisible, so leaning on it alone
would make the single most common row action undiscoverable.

Both ship. Long-press is required regardless — Duplicate, Copy text, Export and
Delete have no touch route at all otherwise — and the resting pin is required
because long-press cannot be discovered. The cost is one faint 12px glyph in a
row footer that already carries a date.

### 5. Hit area grows; ink does not

Each target reaches 44px through an absolutely-positioned pseudo-element while
the drawn control keeps its size. The toolbar stays `h-9`, no menu reflows, and
J2 touches no layout — which is the line drawn above.

**Its honest limit, recorded rather than hidden:** this reaches a full 44×44
only where a control stands alone. Inside `BottomToolbar` an `h-7` button with
`px-2` around a 16px glyph is 32px wide at a 34px pitch (`gap-0.5`), so
expanding past 34 overlaps its neighbour. Those buttons land at **34×44** —
full height, pitch-limited width. Reaching 44×44 there requires the strip to
reflow, which is J3's.

### 6. The resizer is in scope, despite J1

J1 ruled that a `Resizer` is **not rendered** below desktop, which reads like
"no touch problem". It is not: an iPad Pro in landscape is at or above 1024
_and_ reports a coarse pointer, so it renders an 8px `w-2` drag track for a
fingertip. It gets the same hit-area treatment as any other standalone control.

## Components

### New

- **`src/lib/useCoarsePointer.ts`** — mirrors `useLayoutMode`'s shape exactly:
  seeded from `matchMedia` during the **first render**, never an effect. There is
  no SSR here, and an effect-seeded value paints one frame of the wrong
  behaviour. Its test asserts the first value the hook ever returns, which is
  the only assertion that can see that.
- **`src/lib/useLongPress.ts`** — framework-level, no product knowledge, the
  same tier as `useAnchoredMenu` and `useFlushTriggers`. A ~500ms timer opened on
  `pointerdown` when `pointerType !== 'mouse'`; cancelled by `pointermove` past
  ~10px (so a scroll never fires it), `pointerup`, `pointercancel` and
  `contextmenu`. On fire it suppresses the click that would otherwise follow and
  reports the touch point.
- **`e2e/touch.spec.ts`** — the coarse-pointer suite.

### Changed

- `src/styles/editor.css` — an `@media (hover: none)` block beside each of the
  three `:hover` reveals it answers, plus hit areas for the fold toggle and
  badge, the table handles and the code-language trigger.
- The token/utility stylesheet — a `@custom-variant touch (@media (hover: none))`
  and the shared hit-area treatment. The variant is **declared**, not borrowed
  from whatever Tailwind 4.3 happens to ship, so the rule does not move under us
  on a minor upgrade.
- `src/features/notes/NoteListItem.tsx` — resting pin under `touch:`, long-press
  wiring into the existing `NoteRowMenu` request path, and `user-select: none` /
  `-webkit-touch-callout: none` under `(hover: none)` only, so iOS does not raise
  its own selection callout over ours.
- `src/ui/Button.tsx`, `src/ui/Resizer.tsx` — hit-area expansion on coarse
  pointers.
- **One targeted extraction:** the seven menus (`ScopeMenu`, `NoteRowMenu`,
  `EditorContextMenu`, `HeadingMenu`, `TableHandleMenu`, `CalloutMenu`,
  `HighlightMenu`, `ExportMenu`) each carry their own inline item class string
  today. Applying a hit-area rule to seven copies is how they drift, so they
  collapse onto one shared class first. Nothing else is refactored.
- `vitest.setup.ts` + `src/testGlobals.d.ts` — the `matchMedia` stub parses
  `(hover: none)` and `(pointer: coarse)` behind a new `__setPointerCoarse`.

## Testing

The stub **throws** on a query shape it does not understand rather than
answering `false`. That is what makes the omission loud: a hook calling
`matchMedia('(pointer: coarse)')` fails every test that renders the shell until
the stub is extended, instead of quietly pinning every test to the fine-pointer
branch.

- **Unit.** First-value assertions on `useCoarsePointer`; `useLongPress` timer
  and cancel semantics under fake timers; `NoteListItem` opening the row menu on
  a long press.
- **e2e, under `hasTouch: true`.** Resting reveals asserted with a polled
  `toHaveCSS` on `opacity` — never `toBeVisible()`, which ignores `opacity`, the
  trap `e2e/appearance.spec.ts` already documents for this exact pin.
- **Hit areas asserted behaviourally.** Tap a point outside the ink but inside
  the intended target and assert the action fired. A test that merely confirms a
  rect exists is the near-vacuous shape sub-project H hit three times; the
  assertion has to change with the behaviour.
- **Long-press drives real input through CDP** `Input.dispatchTouchEvent`
  (touchStart → 600ms → touchEnd), not `locator.dispatchEvent`. A synthesised DOM
  event is the same mistake as `{ force: true }` in `e2e/pdfExport.spec.ts` — an
  event no user can produce. Chromium generates genuine `pointer` events with
  `pointerType: 'touch'` from CDP touch input, which is what the handler listens
  for.
- **Every rule is sabotaged once and shown red before it is trusted.**

### The risk to flag loudest

`e2e/mobile.spec.ts` already sets `hasTouch: true` in both its phone block
(`:20`, `:207`) and its tablet block (`:162`). **Every test in those blocks
starts running under the new rules the moment this ships.** J1's lesson was that
such tests change _meaning_ rather than going stale — two appearance tests did
exactly that. Re-reading that file line by line is a task in the plan, not a
fix-up performed when it goes red.

`npm run shots` and `npm run measure` run without `hasTouch`, so the 240-file
reference set and the 27 measured surfaces are unaffected. Nobody should
regenerate them looking for a diff.

## Non-goals

- The editor's phone layout, virtual keyboard, floating toolbar placement and
  the top-pill/title overlap — **J3**.
- Safe-area insets, `100dvh`, installability, pull-to-refresh — **J4**.
- Haptic feedback on long-press. iOS Safari implements no `navigator.vibrate` at
  all, so it would be an Android-only feel, and a behaviour that exists on one
  of two platforms is not worth a ruling.
- Reaching 44×44 inside `BottomToolbar`. See decision 5 — it requires a reflow,
  and reflow is J3.
