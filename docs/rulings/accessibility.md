# Accessibility

How this app's controls announce themselves to assistive tech, and which
affordances a control must keep at rest.

**Trigger:** any diff touching `aria-label`, `aria-hidden`, `aria-current`,
`aria-pressed` or an accessible-name assertion; `src/ui/Icon.tsx` (the sole
`lucide-react` importer, which stamps `aria-hidden` on every glyph);
`src/ui/SidebarRow.tsx`'s explicit `{' '}` before the count;
`src/features/notes/NoteListItem.tsx`'s `label` string and its two sibling
buttons; `src/ui/Button.tsx`'s `VARIANTS` map (`default` / `ghost` / `danger`);
`src/features/notes/NoteList.tsx`'s header strip and its scope-header button;
`src/features/notes/ScopeMenu.tsx`'s `role` attributes and disabled-group copy;
`src/features/notes/preview.ts`'s `snippetLines`; `src/ui/ConfirmDialog.tsx`'s
Cancel button; `src/features/editor/HeadingFold.ts`'s `decorations` return
(the `Decoration.node` call and its `aria-label`) and its `.focus()` /
`tabindex` handling; and the hover/name tests in `e2e/appearance.spec.ts`,
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

- **Destructive controls keep their WORDS — that rule stands. What M9a
  reversed is their CHROME, and only in the note-list header.** "Move to
  trash", "Restore", "Delete forever" and "Empty trash" are still text, never
  glyphs: an icon-only control for an irreversible action against a database
  with no server copy asks the user to recall a glyph before destroying data,
  and Bear hides these in menus where we deliberately do not. But "New note",
  "Move to trash" and "Restore" are now `ghost` rather than `default` — no
  border, no resting fill — because the bordered row read as a set of form
  controls and was the single thing that most dated the app. **"Delete forever"
  and "Empty trash" keep `danger`'s solid fill**, and `ConfirmDialog`'s Cancel
  keeps `default`, so M6's reasoning stays live exactly where a control must
  read at rest.

- **A quiet control's hover fill is now load-bearing, and it is the affordance
  this project has already lost once in silence.** `--color-hover` was absent
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
