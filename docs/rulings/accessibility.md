# Accessibility

How this app's controls announce themselves to assistive tech, and which
affordances a control must keep at rest.

**Trigger:** any diff touching `aria-label`, `aria-hidden`, `aria-current`,
`aria-pressed` or an accessible-name assertion; `src/ui/Icon.tsx` (the sole
`lucide-react` importer, which stamps `aria-hidden` on every glyph);
`src/ui/SidebarRow.tsx`'s explicit `{' '}` before the count;
`src/features/notes/NoteListItem.tsx`'s `label` string and its two sibling
buttons; `src/ui/Button.tsx`'s `VARIANTS` map (`default` / `ghost` / `danger`);
`src/features/notes/NoteList.tsx`'s header strip; `src/ui/ConfirmDialog.tsx`'s
Cancel button; and the hover/name tests in `e2e/appearance.spec.ts`,
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

