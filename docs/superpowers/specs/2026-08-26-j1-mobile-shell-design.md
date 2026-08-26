# J1 — Responsive shell and navigation

**Status:** specced, not started. 2026-08-26.
**Parent:** J (Mobile), the first of four sub-projects. J2–J4 are named at the
end of this document and are explicitly NOT in scope here.

## The problem, measured

At 390×844 — an iPhone 14 — bear-web is not cramped. It is unusable.

The sidebar is 240px and the note list is 320px. With two resizers and the
shell's padding that is already more than 390px, so the editor pane is laid out
entirely off-screen. `<main>` carries `overflow-hidden`, and measured in the
real build: `document.documentElement.scrollWidth === clientWidth === 390`.
**The page cannot be scrolled to reach the editor.** A visitor on a phone can
tap a note and can never see or edit one.

There are no responsive rules to soften this: the only `@media` blocks in
`src/styles/` are `prefers-color-scheme` and `prefers-reduced-motion`. The
`<meta name="viewport">` tag is present and correct, which is the whole of the
app's mobile provision today.

## Goal

A phone is a first-class way to read, search and write notes — the user's own
framing, chosen over "read and capture only" and over "just don't break".

This sub-project delivers the shell that makes that possible: one pane at a
time, a drawer for the sidebar, a way back from the editor, and the browser's
own back gesture. It does NOT make touch interaction or the editor itself
pleasant on a phone; those are J2 and J3, and they are not reachable until this
exists.

**Done means:** on a 390px viewport a user can browse notes, filter by a tag,
search, open a note, edit it, and get back — using only touch, with the back
gesture behaving the way it does in any other app. And the desktop layout is
byte-for-byte what it is today.

## Non-goals

- Any change to the desktop layout at `≥ 1024px`. If a desktop screenshot
  differs, that is a defect in this work, not a trade-off.
- A URL scheme, a router, or deep links. See "Back" below for why the history
  integration deliberately does not touch the URL.
- Touch replacements for hover-only affordances, larger tap targets, long-press
  menus (**J2**).
- The virtual keyboard, the floating toolbars, selection handles, tables on a
  phone (**J3**).
- Safe-area insets in general, `100dvh`, installability, pull-to-refresh
  (**J4**). One exception is carved out below for the FAB.

## Layout modes

Three modes, two breakpoints.

| Mode      | Width         | Shell                                                        |
| --------- | ------------- | ------------------------------------------------------------ |
| `phone`   | `< 640px`     | One pane. Sidebar is an overlay drawer; list ↔ editor pushes. |
| `tablet`  | `640–1023px`  | Two panes: list + editor. Sidebar is the same drawer.         |
| `desktop` | `≥ 1024px`    | Today's three panes and two resizers, unchanged.              |

```
phone (390)              tablet (834)                desktop (1280)
┌─────────────┐          ┌───────┬────────────┐      ┌────┬──────┬───────────┐
│ ☰  Notes ⌄ 🔍│          │☰ Notes│  editor    │      │tags│ list │  editor   │
│─────────────│          │───────│            │      │    │      │           │
│ note row    │          │ row   │            │      │    │      │           │
│ note row    │          │ row   │            │      │    │      │           │
│         (+) │          │   (+) │            │      │    │      │           │
└─────────────┘          └───────┴────────────┘      └────┴──────┴───────────┘
```

**1024 is chosen against a constraint, not by taste.** `playwright.config.ts`
runs `devices['Desktop Chrome']`, which is 1280×720. A desktop breakpoint at or
below 1280 keeps every existing e2e assertion valid — including the SEVEN
places that assert the shell has three panes: `codePalette.spec.ts:19,39,107`,
`contrast.spec.ts:138`, and `appearance.spec.ts:302,418,901`. (Two of those
read `getByRole('region')` and one reads `section[aria-label]`; both match,
because Playwright's role query computes the implicit role that a CSS
`[role="region"]` selector inside `page.evaluate` would miss — a distinction
`appearance.spec.ts` already comments on twice.) Above 1024 the three panes
genuinely fit: 240 + 320 + 24px of resizer + 16px of padding leaves the editor
424px.

**640 is a comfort threshold, and the arithmetic says so rather than
pretending it is a hard limit.** Two panes physically fit from 520px up
(320 list + 24 resizer gap + 16 padding + the 160 `MIN_PANE_WIDTH`). At 640 the
editor gets 280px, which is the narrowest column worth writing a sentence in;
below that the list and the editor are both bad instead of one being good. If a
measurement later disagrees, 640 is the number to move — nothing else depends
on it.

### `useLayoutMode()`

A new hook in `src/lib/`, over `matchMedia`, returning
`'phone' | 'tablet' | 'desktop'`.

Not CSS alone, for four reasons that CSS cannot address: the resizers must not
MOUNT (see below), the drawer needs open state and a focus trap, `Pane`'s width
is an inline style computed in JS, and the shell renders a different set of
children per mode. Initial state reads `matchMedia` synchronously during the
first render — there is no SSR here — so there is no layout flash to guard
against.

`src/lib/` may import nothing from `src/app/`, `src/data/`, `src/features/` or
`src/i18n/` (enforced by `scripts/sourceLint.test.ts`). The breakpoint values
live with the hook; the hook has no product knowledge.

**jsdom does not implement `matchMedia`, and nothing in this repo stubs it
today.** `vitest.setup.ts` needs one, or every component test that renders the
shell throws. The stub must let a test choose the mode, since the shell's
component tests depend on it. This is a toolchain surprise worth recording in
CLAUDE.md.

## Navigation state

```ts
const mode   = useLayoutMode();                              // 'phone' | 'tablet' | 'desktop'
const screen = selectedNoteId === null ? 'list' : 'editor';  // phone only
const [drawerOpen, setDrawerOpen] = useState(false);         // phone + tablet
```

**The phone's screen is DERIVED from `selectedNoteId`, never stored.** A stored
screen can disagree with the selection — an editor screen showing no note, a
note open behind a list — and nothing makes those unreachable. Deriving makes
them unrepresentable, and every existing transition then does the right thing
without a rule of its own:

- `handleCreate` selects the new note → the editor opens.
- Trashing or purging clears the selection → you land back on the list.
- Back clears the selection → the editor unmounts and the deferred blank-note
  reclaim runs exactly as it does on desktop (`notes-lifecycle.md`; `discard`
  is a cancellable macrotask keyed in the module-scope `pendingDiscards` map,
  and it refuses to purge a note that held text at mount and was never edited).
- Resizing down from desktop with a note open lands on the editor, which is
  what a user would want, and falls out of the derivation.

**Derive from `selectedNoteId`, not `selectedNote`.** `useNotes` routes every
selection change through a transient `undefined` on the note OBJECT
(`notes-lifecycle.md`), so a screen derived from the object flickers back to the
list mid-switch. The id does not.

### Back

One hook, `useOverlayHistory(isOpen, onClose)` in `src/lib/`, used twice: by the
drawer, and by the phone's editor screen.

On open: `history.pushState({ bearOverlay: id }, '', location.href)`. A
`popstate` whose state lacks that marker calls `onClose`. Closing by any other
route (the back chevron, choosing a tag, Escape) calls `history.back()` so the
entry is consumed rather than accumulating.

**The URL never changes.** There is no scheme to design, no GitHub Pages
sub-path to get wrong, and no 404 on refresh. Refreshing lands on the list,
which is already the app's contract — selection is ephemeral by design, as
`e2e/notes.spec.ts` says in as many words. Android's back button and iOS's
edge-swipe both drive `popstate`, so both work without knowing anything about
this app.

**StrictMode double-mount would push two entries**, leaving the user needing two
backs to leave one screen. The hook must be idempotent per open. This is the
same hazard that left `useSession` stuck on "loading" through all six gates
(CLAUDE.md) — no gate catches it; running the app does.

### The drawer

Reuses `src/ui/Dialog.tsx` rather than growing a second overlay: it already has
the wide-selector focus trap, Escape, and focus restore, and
`accessibility.md` records why that trap must be the wide selector rather than
`'button'`. Modal on phone and tablet.

Its content is `SmartListSidebar` and `TagSidebar` verbatim — no mobile
variants. Choosing a scope or a tag closes the drawer, and the list behind it
is already filtered because scope state is unchanged.

**Focus moves with the screen.** Opening the editor focuses its back control;
closing returns focus to the row that opened it. Without that a screen reader
stays parked on a control that is no longer rendered.

## Resizers and pane widths

**The resizers are not RENDERED below `desktop`, not hidden.** `Resizer` is a
focusable `separator` carrying `aria-valuenow`; `display: none` would remove it
visually while leaving it in the tab order and the accessibility tree.
Conditional render.

**Persisted widths are written in `desktop` only, and applied per mode.**

| Mode      | Sidebar                  | List                                  | Editor    |
| --------- | ------------------------ | ------------------------------------- | --------- |
| `phone`   | drawer, full-width       | `width={undefined}` → fills           | fills     |
| `tablet`  | drawer, full-width       | stored width, clamped (no resizer)    | fills     |
| `desktop` | stored width, resizable  | stored width, resizable               | fills     |

An earlier draft of this spec said every pane below the breakpoint takes
`width={undefined}`. That is wrong for `tablet`: two `flex-1` panes split the
screen in half, giving a 400px note list next to a 400px editor. The list keeps
its stored width there and only the editor flexes.

`pane.sidebarWidth` and `pane.noteListWidth` are never WRITTEN outside
`desktop`, so a phone session cannot overwrite the widths chosen on a desktop,
and returning to a wide window restores them exactly.

**A pre-existing bug closes here.** `clampPaneWidth` bounds each pane to
160–560 with no knowledge of the viewport, so two panes dragged wide in a
1024px window can leave the editor a negative width. It becomes viewport-aware:
each pane is clamped so the other two keep at least `MIN_PANE_WIDTH`. It stays
a pure function in `src/app/paneWidths.ts`, which already has its own unit
tests. `deferred.md` names pane-width persistence as a trigger, so that ruling
is read and extended rather than quietly contradicted.

## The phone's chrome

**The top bar is the existing note-list header, rearranged — not a new
component.** ☰ on the left, the scope button centred, 🔍 on the right. The
scope button already exists and already opens `ScopeMenu`, which already
carries the count, Sort and Preview — the same content as the reference app's
own popover.

The header's current buttons resolve without inventing anywhere to put them:

| Button                              | On a phone                                              |
| ----------------------------------- | ------------------------------------------------------- |
| New note                            | the FAB                                                  |
| Delete / Restore / Delete forever   | the row context menu, which already carries all three     |
| Empty trash                         | stays, moved into `ScopeMenu`                             |

Those three act on the SELECTED note, and on a phone selecting a note means
leaving the list — so they were never coherent in a phone header. The row menu
shipped on 2026-08-26 is what makes this header shrinkable at all.

**Search collapses to a button** that expands the field over the header, with a
cancel. **The input takes 16px at phone width.** `--bear-text-ui` is 13px and
**iOS Safari zooms the page when focusing an input below 16px** — without this,
every search on an iPhone leaves the page zoomed in. This is a bug fix, not
polish, and it is the one typography exception this sub-project makes.

**The FAB gets `env(safe-area-inset-bottom)`, and only the FAB.** General
safe-area handling is J4, but a floating control placed in the exact spot the
OS reserves for the home indicator cannot wait for it.

## Files

**New**

- `src/lib/useLayoutMode.ts` — the hook and its two breakpoint constants.
- `src/lib/useOverlayHistory.ts` — one history entry per open overlay.
- `src/app/MobileTopBar.tsx` — ☰ / scope / 🔍, phone and tablet.
- `src/app/SidebarDrawer.tsx` — `Dialog` + the two existing sidebars.
- `e2e/mobile.spec.ts` — the phone journeys.
- `e2e/shots-mobile.spec.ts` — `@shots`-tagged reference screenshots.

**Changed**

- `src/app/AppShell.tsx` — renders by mode; owns `drawerOpen`.
- `src/app/paneWidths.ts` — viewport-aware clamp.
- `src/features/notes/NoteList.tsx` — header splits by mode; FAB.
- `src/features/notes/SearchField.tsx` — collapsible; 16px at phone width.
- `src/features/notes/ScopeMenu.tsx` — gains Empty trash on phone.
- `vitest.setup.ts` — `matchMedia` stub.

`playwright.config.ts` is deliberately NOT changed: the phone viewport is set
with `test.use` inside `e2e/mobile.spec.ts`, and the existing
`grepInvert: /@shots|@measure/` already keeps the new shots spec out of
`npm run test:e2e`.
- `CLAUDE.md`, `docs/rulings/design-tokens-and-layout.md`,
  `docs/rulings/accessibility.md`, `docs/rulings/deferred.md`.

## Testing

**Unit.** `clampPaneWidth`'s viewport awareness is pure and belongs in the
existing `paneWidths.test.ts`. `useLayoutMode` is tested against the new
`matchMedia` stub, including that it updates when the query changes rather than
only reading once.

**Component.** `AppShell` rendered at each mode: `phone` shows exactly one
`section[aria-label]`, no resizers, and a ☰; tapping a row shows the editor and
hides the list; back shows the list again. `tablet` shows two sections and no
resizers. `desktop` shows three sections and two resizers — the regression
guard for the non-goal.

**`useOverlayHistory` may not be unit-testable.** jsdom implements `pushState`
but drives `popstate` asynchronously and inconsistently. If it cannot be driven
deterministically, the hook's contract is covered by e2e (`page.goBack()`)
instead, and the unit test is not written rather than written vacuously — the
repo has a standing objection to assertions that cannot fail.

**e2e.** A new `e2e/mobile.spec.ts` under `test.use({ viewport: { width: 390,
height: 844 }, hasTouch: true, isMobile: true })`:

- list → tap a row → editor → back → list, with the note's text visible in
  between.
- ☰ → drawer → tap a tag → drawer closes and the list is filtered.
- `page.goBack()` from the editor returns to the list; from the drawer, closes
  it. This is the Android-back contract and the reason the history hook exists.
- the FAB creates a note and opens it.
- the search input computes to `16px` — a `toHaveCSS` assertion, because this
  is the zoom bug and nothing else can see it.

**A guard on the guard.** Eight existing e2e assertions now depend on the
Playwright viewport being at or above the desktop breakpoint. A single test
asserts `page.viewportSize().width >= 1024` with a comment naming what breaks
otherwise — so lowering the configured viewport fails one honest test instead
of eight confusing ones.

**Screenshots, because no test can see "renders wrong".** `e2e/shots-mobile.spec.ts`,
tagged `@shots` so the existing `grepInvert` in `playwright.config.ts` keeps it
out of `npm run test:e2e`, writes four phone shots — list, drawer, editor,
search open — in the default theme only. Not sixteen themes: the desktop shots
already cover the theme roster, and this is a layout check.

**And the class of bug no gate can see.** `useSession`'s StrictMode defect
passed all six gates and was found by running the app. The history hook is the
same shape. Verification includes driving the real app in a real mobile browser
context, not only the suite.

## Risks

- **The 8 existing three-pane assertions become viewport-dependent.** Mitigated
  by the viewport guard test above.
- **`Dialog` may assume a centred modal.** If its geometry cannot express an
  edge-anchored drawer, the drawer takes `Dialog`'s focus-trap behaviour by
  extraction rather than by reuse — but a second focus trap is not acceptable,
  and `ConfirmDialog`'s narrow-selector gap is on record as what that costs.
- **StrictMode and `pushState`** — see above; the hook must be idempotent.
- **Scope creep into J2.** A phone shell whose targets are 24px will feel
  broken, and the temptation is to fix tap targets here. It is J2's job. What
  this sub-project owes is that every control is REACHABLE, not that it is
  comfortable.

## The rest of J

- **J2 — touch parity.** Hover-only affordances (the note row's pin, the fold
  chevron, the table handles, the resizer's hit area) and every right-click
  route need a touch equivalent; tap targets to 44px. The row pin shipped
  hover-revealed on 2026-08-26 with the row context menu as its non-hover
  route — on a phone there is no right-click either, so long-press is the
  likely answer and is J2's to rule on.
- **J3 — the editor on a phone.** `visualViewport` and the virtual keyboard,
  the floating top and bottom toolbars, selection handles, the code-language
  popover, tables.
- **J4 — platform chrome.** Safe-area insets throughout, `100dvh`,
  installability, pull-to-refresh, and whether an installed PWA changes the
  answer on routing.
