# Accessibility

How this app's controls announce themselves to assistive tech, and which
affordances a control must keep at rest.

**Trigger:** any diff touching `aria-label`, `aria-hidden`, `aria-current`,
`aria-pressed`, `aria-disabled` or an accessible-name assertion;
`src/features/export/ExportMenu.tsx`'s disabled PDF item; `src/features/editor/EditorContextMenu.tsx`
(the `menuitemcheckbox`/`menuitemradio`/`menuitem` roles and the `Shift+F10`
route into it) and `src/features/editor/HighlightPalette.tsx`; `src/ui/Icon.tsx` (the sole
`lucide-react` importer, which stamps `aria-hidden` on every glyph);
`src/ui/SidebarRow.tsx`'s explicit `{' '}` before the count;
`src/features/notes/NoteListItem.tsx`'s `label` string and its two sibling
buttons; `src/ui/Button.tsx`'s `VARIANTS` map (`default` / `ghost` / `danger`);
`src/features/notes/NoteList.tsx`'s header strip and its scope-header button;
`src/features/notes/ScopeMenu.tsx`'s `role` attributes and disabled-group copy;
`src/features/notes/preview.ts`'s `snippetLines`;
`src/features/notes/NoteRowMenu.tsx`'s roles, its `Shift+F10` route in
`NoteListItem.tsx` and its `aria-disabled` PDF item; the thumbnail's `alt` in
`NoteListItem.tsx`; `src/ui/ConfirmDialog.tsx`'s
Cancel button; `src/features/editor/HeadingFold.ts`'s `decorations` return
(the `Decoration.node` call and its `aria-label`) and its `.focus()` /
`tabindex` handling; `src/features/editor/TableHandles.ts`'s handle buttons
(`aria-haspopup`, `aria-expanded`) and `src/features/editor/
TableHandleMenu.tsx`; and the hover/name tests in `e2e/appearance.spec.ts`,
`src/ui/ui.test.tsx` and `src/features/notes/NoteListItem.test.tsx`.

- **Never rely on a CSS `gap` to separate text for assistive tech.**
  Accessible-name computation concatenates text content and ignores gaps. M5.5
  shipped and reverted a regression where a tag row announced as `"work3"`
  instead of `"work 3"` after `SidebarRow` dropped an explicit space text
  node — the visual `gap-2` hid it completely, and the first fix attempt
  edited the failing tests to match. `src/ui/SidebarRow.tsx` carries an
  explicit `{' '}` and `ui.test.tsx` pins the resulting accessible name.

- **The pin button is a sibling of the row button, never nested.** A `<button>`
  inside a `<button>` is invalid HTML and unclickable in some browsers.

- **`NoteListItem` carries an explicit `aria-label`.** Its three sibling
  spans concatenate with no separator and accessible-name computation ignores
  the CSS gap, so the row announced as `"Groceries14:32milk"` from M3 until
  M7. The label also keeps highlight markup out of the name. Same root cause
  as the `SidebarRow` regression M5.5 caught and reverted — and, as there, a
  role-based test that fails during a restyle is reporting a behaviour
  change, not a stale expectation.

- **Every icon is `aria-hidden` and every icon-only control carries an
  `aria-label` from `useT`.** Replacing text with icons is the standard way to
  silently destroy a screen-reader experience, and this project has shipped
  that defect class twice — `SidebarRow` losing a space so a row announced as
  `"work3"`, and `NoteListItem` concatenating three spans into
  `"Groceries14:32milk"`.

- **Destructive controls keep their WORDS — that rule stands, unconditionally.**
  "Move to trash", "Restore", "Delete forever" and "Empty trash" are text,
  never glyphs: an icon-only control for an irreversible action against a
  database with no server copy asks the user to recall a glyph before
  destroying data.

- **A control's resting chrome depends on the POINTER, and M9a's borderless
  ruling was rewritten in J2 rather than given an exception.**

  M9a made the note-list header `ghost` — no border, no resting fill —
  because the bordered row read as a set of form controls and was the single
  thing that most dated the app. What replaced the resting affordance was
  "position, familiarity, and a hover fill". **That last clause is what does
  not survive a touch screen**: there is no pointer to cross the control, so a
  quiet control is quiet forever, and on a phone the header's two icon buttons
  were invisible affordances rather than restrained ones.

  So the rule is now stated in terms of the condition that actually decides
  it, rather than as a blanket preference:

  - **Hover exists (desktop, `≥1024`):** quiet at rest, fill on hover.
    `ghost`. M9a's reasoning holds here unchanged.
  - **Hover does not exist (phone and tablet):** a resting fill. `soft`, a
    44×44 circular target. The reference app does the same, and the
    alternative is a control the user must guess at.

  **"Delete forever" and "Empty trash" keep `danger`'s solid fill at every
  size**, and `ConfirmDialog`'s Cancel keeps `default`, so M6's reasoning
  stays live exactly where a control must read at rest.

- **A quiet control's hover fill is load-bearing ON DESKTOP, and it is the
  affordance this project has already lost once in silence.** (On touch it is
  no affordance at all — see the pointer rule above.) `--color-hover` was absent
  from the theme block for two milestones, so every `hover:bg-hover` compiled to
  nothing with no warning. A `ghost` control whose hover does not compile is
  invisible in every state — strictly worse than the M6 defect. `e2e/appearance.spec.ts`
  asserts the rendered hover background, that it differs from the pane, and that
  the control is still quiet at rest so an undone reversal is noticed.

- **The pin button reads by colour, not by glyph.** A `Pin`/`PinOff` glyph
  table keyed on `note.pinned` was tried and reverted: a slashed pin in the
  unpinned state reads as "pinning is unavailable" (the same grammar as a
  muted-mic or no-wifi glyph), not "click to pin". The button is always the
  `Pin` glyph, differentiated by colour; `aria-label` and `aria-pressed` carry
  the state for assistive tech.

- **A heading containing a `Decoration.widget` becomes a subtree Chromium
  refuses `.focus()` to, for every descendant — established by measurement,
  not inferred.** `HeadingFold.ts:436-437` cites seven live Playwright
  experiments, enumerated in Task 4's fix report (`.superpowers/sdd/`, local
  and gitignored — not Task 8's, which contains none of this enumeration).
  Since that ledger does not survive outside this machine's working copy,
  the seven are repeated here in full:
  1. A bare `# Hello` with HeadingFold's decorations disabled: an injected
     `<button tabindex="0" contenteditable="false">` inside the real `<h1>`
     focuses fine.
  2. Same heading, only the `aria-label` node decoration re-enabled (no
     widgets): the injected button still focuses fine.
  3. Same heading, only the widgets re-enabled (no `aria-label` decoration):
     the injected button does NOT focus, before or after the widgets.
  4. The real toggle itself, given an explicit `tabindex="0"` and called via
     a plain `page.evaluate(() => toggle.focus())` with no keydown at all:
     still does not focus.
  5. A nested (non-top-level) heading, which `headingSections()` excludes
     from all decorations, allows an injected button to focus fine — ruling
     out the tag name `h1`/`h2` itself as the cause.
  6. A synthetic `<h2>` created via `document.createElement` and appended
     directly into `.ProseMirror`, never touched by ProseMirror's own
     rendering, allows focus fine with or without `aria-label` — ruling out
     `aria-label` alone as the cause.
  7. Deferred focus attempts (`requestAnimationFrame`, `setTimeout(0)`,
     blurring the view first) all still fail — ruling out a timing/re-render
     race.

  Once a heading has ANY `Decoration.widget` child, `.focus()` silently
  fails for every element under that heading, independent of `tabindex`,
  DOM position, or whether the target is the widget itself — even a bare,
  unrelated, manually injected `<button tabindex="0">` placed elsewhere in
  the same heading is equally unfocusable. The same heading with the
  widgets removed focuses normally. The explanation on file — that Chromium
  excludes a whole editing-host subtree once it contains a
  `contenteditable="false"` widget island — is a HYPOTHESIS consistent with
  the measurements above (especially #5 and #6), not a cited mechanism;
  treat the seven measurements as fact and the explanation as open. This is
  why the gutter's toggle and badge are mouse-only controls and why
  `Mod-Alt-f` exists as the keyboard route: no focusable in-editor control
  could be built at all.

- **The fold widgets sit inside the heading, at `section.pos + 1`, not
  `section.pos` — this is required, not stylistic.** A widget at `section.pos`
  renders as the heading's DOM *sibling*, not its child: every
  `.ProseMirror h2:hover .bear-fold-toggle`-shaped CSS rule stops matching,
  and the widget's `position: absolute` resolves against the wrong
  positioned ancestor. `pos + 1` is the start of the heading's own inline
  content, making the widget a genuine child of the heading element.

- **The badge's digit needs its own `aria-label` fix, or it corrupts the
  heading's accessible name.** Because the badge widget is a DOM child of the
  heading, its `textContent` (the level digit) concatenates into the
  heading's own accessible-name computation unless something stops it — an
  embedded control's `aria-label` is ignored for THAT control's own name but
  still contributes its text content to an ancestor's name unless the
  ancestor supplies an explicit `aria-label` of its own. `HeadingFold.ts`
  pins each heading's name with a `Decoration.node(section.pos,
  section.contentStart, { 'aria-label': section.text })`. Measured with the
  repo's own `dom-accessibility-api`: without that decoration a heading whose
  text is "Hello" announces as `"1 Hello"`; with it, `"Hello"`.

- **Preview size drives the rendered row and its accessible name from ONE
  decision.** `snippetLines(size)` returns 0, 1 or 2, and `NoteListItem` uses
  that same value for both the rendered snippet and the `aria-label`. At Small
  the row announces `title, date` and nothing more, because the name must never
  describe content a sighted user cannot see. The alternative — always
  announcing the full triple regardless of density — was considered and
  rejected: it creates two contracts where there is one, and this row's label
  exists precisely because the announcement once diverged from the rendering
  ("Groceries14:32milk and bread", M3 to M7). Confirmed falsifiable by
  injecting an always-full label.

- **The scope-header button is named `List options: {scope}`, not `{scope}`.**
  The sidebar already has a row named "Notes"; two controls sharing an
  accessible name is ambiguous to anyone reaching for either, and the bare
  scope name does not convey that the button opens anything. The visible label
  is still contained in the accessible name, as WCAG 2.5.3 requires.

- **`ScopeMenu` conveys its checkmarks structurally AND visually.** One-of-N
  choices are `role="menuitemradio"` with `aria-checked`; the two toggles are
  `role="menuitemcheckbox"`. The ✓ glyph is `aria-hidden` decoration on top of
  that, never the signal — but it must be present: the scope rows shipped
  briefly with `aria-checked` and no glyph, and a sighted user could not tell
  which list was current from inside the menu. That gap was found by eye in a
  screenshot, not by any test.

- **A disabled menu group carries copy naming the reason.** The sort group in
  Trash and the sub-tag toggle outside a tag scope both render an explanatory
  line beside the disabled rows. Same rule B1 invoked to reject hiding the fold
  affordance below a pane-width threshold, and `deferred.md` invoked again
  against the title-line affordance.

- **Roving arrow-key movement in `ScopeMenu` skips disabled rows**, so a
  disabled group is a skipped region rather than a dead stop. `ExportMenu` has
  no equivalent because three rows did not need one; sixteen do.

- **`Button` declares `ariaHasPopup` / `ariaExpanded` explicitly, never a prop
  spread.** A button that opens a menu has to say so, and those two are the
  only ARIA a presentation primitive can own without knowing what the menu
  contains.

- **The Chromium widget-focus finding is about HEADINGS, and does NOT
  generalise to every `Decoration.widget`.** The seven experiments above
  establish that a heading containing a widget becomes a subtree Chromium
  refuses `.focus()` to. A button inside the table bar's widget — also a
  `Decoration.widget`, also `contenteditable="false"`, also inside the
  ProseMirror DOM — takes focus normally. Measured, not assumed:
  `e2e/editorAffordances.spec.ts` calls `.focus()` on a bar button and asserts
  `document.activeElement`. That is why the table bar needs no keyboard escape
  hatch of its own while the fold gutter needed `Mod-Alt-F`. If Chromium ever
  widens the heading behaviour, that test fails and the bar needs the same
  treatment.

- **The table bar's WORDS-not-glyphs rule is gone WITH THE BAR, but it
  strengthens the destructive-control rule rather than reversing it.** The bar
  itself no longer exists — sub-project H replaced it with edge handles and a
  right-click context menu. The original reasoning was that three of the bar's
  five buttons deleted content, and an icon-only "delete column" asks the user
  to recall a glyph before throwing data away, the same objection that keeps
  "Delete forever" and "Empty trash" as text. That reasoning did not get
  weaker; the destructive three (`Delete row`, `Delete column`, `Delete table`)
  are now named ROWS in `EditorContextMenu.tsx`, plain `menuitem`s with real
  words, not icons — the words survive and moved somewhere a mis-aimed hover
  cannot reach them, since a menu row requires a deliberate click to even be
  near, unlike a bar button sitting in the flow of the page. Only the word
  still takes `--bear-danger`; the fill stays quiet, matching "Move to trash"
  in the note list.

- **The fold badge's level is now a `Heading1`–`Heading6` glyph, and the
  accessible-name test it broke had to be REWRITTEN, not merely kept green.**
  The badge's digit was the measured pollution source for the heading's
  accessible name; a glyph contributes no text, so simply un-hiding the badge
  no longer pollutes anything and that test would have passed with the
  `Decoration.node` aria-label DELETED — a vacuous assertion in the exact
  place the file exists to prevent one. It now un-hides the badge AND gives it
  text, simulating any future widget that forgets to hide itself, because what
  is being pinned is the decoration, not the badge's current markup.

- **Six level glyphs, not one generic `Heading`.** The badge's whole job is to
  say which level this heading is, which is what the digit conveyed. Trading a
  legibility complaint for an information loss would not be a fix.

- **A preview must not join the control's accessible name.** `ThemeDialog`'s
  cards show a theme name, a pangram and an accent line; without an explicit
  `aria-label` all three concatenate and every one of seventeen radios
  announces as "Nord The quick brown fox jumps over the lazy dog. a link, and
  a tag". Same defect class as `SidebarRow`'s lost space and
  `NoteListItem`'s three concatenated spans, and found the same way — by
  looking at the rendered result, not by a test failing. The preview exists to
  be looked at, so it is `aria-hidden`; the card's name is the theme's name
  and nothing else.

- **`src/ui/Dialog.tsx`'s focus trap uses the WIDE focusable selector, and
  `ConfirmDialog`'s old `'button'` query was the defect it fixed.** A trap
  that skips a focusable does not hold it at the modal's edge — it lets Tab
  walk out into the page behind, where the user cannot see where focus went,
  which is worse than no trap at all. `ConfirmDialog` documented that gap in
  its own comments and lived with it because it holds exactly two buttons.
  Pinned by a test that fails if the selector narrows again.

- **`ConfirmDialog`'s Cancel button must stay FIRST in DOM order.** `Dialog`
  focuses the first focusable, and these dialogs guard irreversible deletion
  with no server copy, so an Enter keypress already in flight when the dialog
  opens must not destroy anything. Reordering the two buttons silently changes
  which one it hits. `role="alertdialog"` rather than `dialog` is part of the
  same rule and is not decoration.

- **The theme picker is a `radiogroup` of `radio`s, not a menu.** One choice
  is always in effect, which is what radio semantics carry. Its light/dark
  separators are headings, NOT nested `role="group"` wrappers: a `group`
  sitting between a `radiogroup` and its radios is not a shape ARIA defines.

- **The editing context menu's keyboard route is not optional, and its roles
  are chosen per action shape.** `Shift+F10` (via `ContextMenu.ts`'s
  `Shift-F10` keymap entry, dispatching `openContextMenu`) is the keyboard
  equivalent of a right-click and must open the same menu at the caret — a
  pointer-only affordance for editing commands this central would be a
  regression, not a convenience. Inside the menu, `role="menuitemcheckbox"`
  marks an independently-toggleable state (bold, italic, the four list/quote
  toggles), `role="menuitemradio"` marks a MUTUALLY EXCLUSIVE choice (the
  heading level row, the highlight colour row), and plain `role="menuitem"`
  marks a one-shot action (insert/delete row or column, delete table). The
  accepted cost: `ContextMenu.ts` calls `event.preventDefault()` on the native
  `contextmenu` event to show ours instead, which also removes the browser's
  OWN spellcheck suggestions, Look Up and Services from the writing surface —
  there is no way to keep half of a native menu. Overriding `contextmenu` is an
  all-or-nothing trade, made deliberately.

- **A `menuitemradio` group must be able to represent every one of its
  options, or it is lying to sighted users too, not only to assistive tech.**
  The heading row shipped reading `EditorFlags.heading1` alone, which is `true`
  only at level 1 — so a caret in an H2 through H6 heading opened the menu with
  NONE of the six rows checked, and five of six heading levels could simply
  never show as checked no matter where the caret sat. Because
  `aria-checked:bg-selected` is what paints the row's highlight, this was
  visible on screen, not just to a screen reader — the same defect shape as
  the scope-menu checkmark gap above. Fixed by widening `EditorFlags` with
  `headingLevel: number | null` (computed independently of the pre-existing
  `heading1`, which the toolbar's own `aria-pressed` still reads), and having
  the menu's radio row check `headingLevel === n` instead.

- **A table row/column handle is a button that OPENS A MENU, and says so with
  real ARIA — `aria-haspopup="menu"` plus `aria-expanded`, flipped
  imperatively rather than left at rest.** `TableHandles.ts` is a plain-DOM
  ProseMirror widget with no React state of its own, so it cannot re-render
  `aria-expanded` the way a `Button`-backed menu trigger would; `mousedown`
  sets it `true` when the request fires, and `RichEditor`'s `onClose` for
  `TableHandleMenu` sets it back `false` on the same element (via
  `TableHandleMenuRequest.anchor`, carried through the request for exactly
  this — the same "hand the app a DOM rect" pattern `HeadingMenuRequest.rect`
  already used, extended to a full element reference). This replaced a `+`
  handle that inserted directly on click and needed neither attribute: a
  button that immediately acts is not a disclosure control, but a button that
  opens a menu is, and CLAUDE.md's `Button.ariaHasPopup`/`ariaExpanded` rule
  applies here even though this handle is not a `Button` component.

  **Focus return after closing uses the handle itself, not the editor — proven
  safe by the widget-focus bullet immediately above, not assumed.** A table
  handle is also a `Decoration.widget`, also `contenteditable="false"`, also
  inside the ProseMirror DOM, and the measured finding right above this bullet
  already establishes that such a button focuses normally (`e2e/
editorAffordances.spec.ts`'s bar-button check, pre-dating this menu). Unlike
  `HeadingMenu`'s badge — which cannot return focus to itself and falls back
  to `editor.commands.focus()` — `TableHandleMenu`'s `onClose` calls
  `tableMenu.anchor.focus()` directly.

- **An unavailable menu item is `aria-disabled`, never the HTML `disabled`
  attribute — and Playwright then cannot click it at all.** `ExportMenu`'s PDF
  item is unavailable when signed out, and the reason for a control to be
  unavailable is exactly what the user needs to hear: an HTML-disabled button
  leaves the tab order, so a keyboard user could never reach it to find out
  why. `aria-disabled` keeps it reachable, `onClick` refuses the action itself,
  and an `sr-only` span carries `export.pdf.requiresSignIn` so the accessible
  name says what to do about it.

  The consequence for tests is not obvious and cost a wrong first draft:
  Playwright's actionability check treats `aria-disabled="true"` as "element is
  not enabled" and waits out the full timeout rather than clicking. So the
  obvious assertion — click it, expect nothing to happen — is impossible to
  write, not merely wrong. Drive it the way the attribute exists to allow:
  `Tab` to it, assert it is focused, press `Enter`. Reaching for
  `click({ force: true })` instead synthesises an event no real user can
  produce, and would pass on a control no keyboard user could reach.


- **The note row's context menu needs the `Shift+F10` route for the same
  reason the editor's does, and here the stakes are higher.** Delete, Restore
  and Delete forever live in that menu; without the keyboard opener a keyboard
  user would have no route to them from the list at all for a note that is not
  the current selection (the header's buttons act on the selection only). The
  row's select button handles the key itself and anchors the menu on its OWN
  rect, where the pointer route anchors on a zero-size rect at the click point
  — the same two-shapes-one-field arrangement `ContextMenuRequest.rect` uses.

- **A right-click on a row does NOT select it, and every item in the menu is
  therefore addressed by the request's `noteId`.** A menu that read
  `selectedNoteId` would delete the wrong note whenever the user right-clicked
  a row other than the open one, which is the ordinary case. `NoteList.test.tsx`
  pins this by opening the menu on one row while a DIFFERENT row is selected
  and asserting which id the action carried — an assertion that changes with
  the behaviour, rather than merely proving an action fired.

- **The row menu's Pin item is a plain `menuitem`, not a `menuitemcheckbox`.**
  The row it acts on already shows the pin state, and the item's own words flip
  between "Pin note" and "Unpin note" — a checked state on top of a verb that
  already changes would describe the note twice and disagree with itself half
  the time. The pin BUTTON on the row keeps `aria-pressed`, because it is a
  toggle whose label is its only other signal.

- **The row's thumbnail is `alt=""`, deliberately.** It is decoration derived
  from text the row's own preview line already announces, so a filename read
  aloud between the preview and the date is noise — the same reasoning that
  made `ThemeDialog`'s card previews `aria-hidden`. Pinned by a test asserting
  the URL and the alt text are both absent from the row's accessible name.


- **The phone's back control is a real focusable button, not a gesture.** A
  swipe-driven shell was considered and rejected partly for this: there would
  be no visible control to name, and the keyboard and screen-reader routes
  this project has been strict about would have nothing to land on. Focus
  moves to the back control when the editor screen opens and returns to the
  row when it closes — a screen swap has no `Dialog`-style focus restore, so
  without it a screen-reader user is parked on a row that is no longer
  rendered.

- **The FAB reuses `noteList.create`.** One action must not announce two
  different ways depending on the viewport, and a phone user and a desktop
  user are describing the same button to each other. Pinned by a test that
  compares the two accessible names directly rather than asserting a literal.

- **`search.open` is "Show search", NOT "Search notes".** The field is already
  named "Search notes" (`search.label`), and two controls sharing an
  accessible name is ambiguous to anyone reaching for either — the same rule
  that makes the scope button "List options: {scope}" rather than "Notes".
  This was caught while writing the key, not by a test: nothing in the suite
  compares accessible names across components for collisions.

- **The sidebar drawer is a `Dialog`, and must stay one.** It inherits the
  wide-selector focus trap, `aria-modal`, Escape, and focus restore. A second,
  narrower trap would reintroduce the gap `ConfirmDialog` documented and lived
  with: a trap that skips a focusable lets Tab walk out into the page behind,
  where the user cannot see where focus went.


- **Touch targets are 44×44 below the desktop breakpoint.** `Button`'s `touch`
  size, which is the iOS minimum and WCAG 2.5.8's. Its radius lives in the
  SIZES map rather than the base class list, so `touch` can be a circle by
  OMITTING `rounded-sm` — two `rounded-*` utilities in the same layer are
  resolved by stylesheet order, not by the class attribute's order.

- **The compact header is 56px with a centred 16px title, and that is a
  correction rather than a preference.** It shipped in J1 as the desktop strip
  with two buttons swapped in: `h-9` (36px) with 28px controls and a 13px
  left-aligned title, all sized for a mouse. On a real iPhone it read as a
  caption bar. The title centres via a three-column grid, so it centres
  against the BAR rather than against whatever the left group happens to
  measure — with a flex row it drifts as the scope name changes length.
