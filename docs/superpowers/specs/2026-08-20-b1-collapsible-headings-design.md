# B1 — Collapsible headings and the level badge

Written 2026-08-20. Sub-project **B** of the three in `docs/superpowers/NEXT.md`,
split into **B1** (this spec) and **B2** (drag-to-reorder, deferred — see
"Out of scope").

The M9a spec called this sub-project **M9c**. The letter is `NEXT.md`'s and is
not a milestone id.

## Purpose

Long, heading-dense notes are what this user actually writes, and today there is
no way to collapse anything: a 3000-word note is a single unbroken scroll. B1
adds a gutter affordance on every heading that folds its section, plus a menu on
that affordance for changing the heading's level.

Two capabilities share one trigger, and they are genuinely separate:

- **Folding** is new. Nothing in the app does it.
- **Setting a heading level** is not new but is currently unreachable. The
  bottom toolbar has exactly one heading button and it toggles level 1;
  `##`–`######` can only be produced by typing the Markdown. `Mod-Alt-1`
  through `Mod-Alt-6` are already bound by `@tiptap/extension-heading` and work
  today — they are undiscoverable, not absent. The menu surfaces them.

## Decisions already taken

Recorded here because each one closes a question that would otherwise be
re-opened during implementation.

### Folds are durable

A fold survives a note switch and a browser reload. `NoteEditor` is keyed by
`note.id`, so switching notes unmounts the editor entirely; without persistence
every fold would be lost on the most ordinary navigation in the app.

### Fold identity is text + level + occurrence, and it fails open

A fold is stored as `{ level, text, nth }` — the heading's level, its exact text,
and which occurrence it is among headings sharing both. On mount the document's
headings are walked and matched.

Rejected alternatives, with reasons, because both are the obvious thing to reach
for later:

- **Ordinal index** ("the 3rd heading is folded") fails *closed*: inserting one
  heading near the top shifts every fold below it, hiding sections the user
  never folded. It fails on the single most common edit in a heading-dense note.
- **An id written into the document** (`{#id}`, an HTML comment) is perfectly
  stable and is rejected on principle. It would put view state into the user's
  Markdown, against the standing rules that opening a note produces no write and
  that an export must not change a byte of the user's own file.

The chosen scheme's failure modes are all the same shape: a heading that cannot
be matched is **not folded**, and the user sees their content. Renaming a folded
heading unfolds it. That direction is mandatory, not incidental — the opposite
failure hides content in an app with no server copy, which is indistinguishable
from data loss.

### The gutter is reserved, not overlaid — what shipped and why

This section originally planned an affordance that OVERLAYS the prose when
there is no gutter: absolutely positioned, floating over the text's left
edge below roughly 688px of pane width, on the reasoning that reserving a
permanent lane would narrow the measure at every width, including the wide
case where the gutter is already free.

**That is not what shipped, and this section is corrected to describe the
actual mechanism.** `.ProseMirror`'s rule is
`max-width: min(var(--bear-line-width), 100% - 3rem)` (`src/styles/editor.css`),
plus a separate `min-width: 12rem` floor. This RESERVES 1.5rem of margin on
each side whenever the pane is narrower than the measure plus 3rem, rather
than letting the prose run edge to edge and overlaying the toggle on top of
it. The outcome is better than the original plan — the toggle never sits on
top of live text at any width — but the original "narrows the measure at
every width" objection is still real at the threshold itself: at exactly
`--bear-line-width` + 3rem of pane width, the reserved margin and the
would-be-zero gutter meet, and clearance for the toggle is exactly zero
there. A future change to `EditorContent`'s own `px-6` padding narrows that
already-zero margin further and silently reopens the clipping bug this
mechanism exists to prevent (see CLAUDE.md's `--bear-line-width` /
`min-width: 12rem` toolchain-surprise entry for the measured history of that
clip). Hiding the affordance below a threshold was rejected against the
standing rule that behaviour must not depend on invisible state — folding
would silently become unavailable with nothing on screen to explain why.

## Out of scope

- **B2, drag-to-reorder.** Grabbing the badge to move a heading and its subtree
  is a document mutation with its own drop-indicator coordinate math, undo
  semantics, and interaction with folded regions. It also cannot be unit tested
  at all: jsdom has no `setPointerCapture`, so Playwright is its only possible
  coverage. It gets its own spec.
- **"여기로 링크 복사" (copy link to here)**, the last item in Bear's menu. It
  needs per-note and per-heading URLs and this app has no routing — no history,
  no deep links. Already cut in `NEXT.md` with this reason.
- **M9b callout blocks**, deferred and unrelated.
- **Folding anything that is not a heading.** No list folding, no blockquote
  folding, no code-block folding.

## Architecture

### `HeadingFold`, a Tiptap `Extension`

An `Extension`, never a `Node` or `Mark`. This is load-bearing rather than
stylistic: an `Extension` registers nothing in the schema, so
`getSchema(editorExtensions)`, `computeRecognizedHtmlTags()` and every
round-trip suite are unaffected by it, exactly as `TagPill` is. The document is
never touched, so a fold cannot survive into a note's Markdown, cannot reach an
export, and cannot be seen by the serializer.

It registers in `buildSupportedExtensions` alongside `TagPill`. Like `TagPill`
it takes options from the app; like `TagPill` it must be called with `{}` inside
`computeRecognizedHtmlTags`, so injected options can never change what that
schema build sees.

### What a section is

A heading's section runs from the heading to the next heading of the **same or
higher** level, or to the end of the document. An `h2` folds everything until
the next `h2` or `h1`; nested `h3`s go with it.

### Fold state and decorations

The plugin holds the fold set as identities, not positions. On any transaction
that changed the document it re-walks the headings and rebuilds:

- **Hiding**: a `Decoration.node` carrying a class on every block inside a
  folded section. Hiding is CSS. No node is removed and no position changes.
- **The affordance**: a `Decoration.widget` at each heading's position, holding
  the chevron and the `≡N` badge. The widget is `contentEditable=false` and
  stops its own events so clicking it never moves the caret — the same
  discipline `TagPill`'s `mousedown` handling already applies for the opposite
  reason.

Within a mounted editor, positions are mapped by ProseMirror through
transactions and identities are only recomputed when the document actually
changed. Identity matching runs on mount and after a document change, not on
every selection change.

### The menu is the app's, not the plugin's

The plugin does not render the menu. Clicking the badge calls an injected
callback with the heading's position, level and screen rectangle; `RichEditor`
renders the menu in React and calls back into commands. This mirrors the
existing `TagPill`/`onActivateTag` boundary, where the editor deliberately
learns nothing about app concerns and the app answers.

Consequence, accepted and inherited from `TagPill`: the menu's locale is frozen
at mount, because `RichEditor` builds its extension array once. A note switch
remounts the editor anyway, so this is only visible if the user changes locale
and keeps the same note open.

### Persistence

A dedicated Dexie table `noteFolds`, keyed by note id, holding the fold
identities for that note.

- **Not on the note record.** Writing there would move `updatedAt` and reorder
  the note list every time the user folds something.
- **Not the `settings` table.** It is a flat key-value bag and would accumulate
  one row per note that has ever been folded, forever.
- **Cleared by `notes.purge` and `emptyTrash`**, the way the `noteTags` index is
  already kept consistent with the notes that exist.
- **Excluded from the backup bundle.** Fold state is view state, not content; a
  restore should return the user's notes, not their reading position.
  `importDatabase` is replace-only and validates strictly, so adding a table to
  it is cost with no benefit. An imported database simply opens unfolded.

A new table means a Dexie version bump. `version(1)` is IndexedDB version 10 in
this codebase and seeding has produced a silently-blocked upgrade before, so the
bump and `e2e/fixtures/seed.ts` need checking together.

Writes are debounced and must never block a fold from rendering: the fold
applies immediately in plugin state and is persisted afterwards. A failed write
costs a fold, never content.

## Interaction

- The chevron and badge appear on **hover over the heading or over the gutter
  beside it**, and while the menu is open.
- **Click the chevron** toggles the fold. **Click the badge** opens the menu.
- A folded heading keeps a persistent indicator even when not hovered —
  otherwise a folded section is indistinguishable from a note that simply has no
  content there, which is the "invisible state" failure again. **That indicator
  is inline, at the end of the heading's own line, not in the gutter.** The
  gutter affordance is hover-only precisely so it never covers text at rest, and
  a persistent gutter mark would reintroduce exactly that at a narrowed pane. An
  inline marker is inside the measure, in flow, covers nothing, and reads
  naturally as "there is more here".
- **Menu**: 머리말 1–6 with their `⌘⌥N` shortcuts and a check on the current
  level; a separator; 접기 전환 (toggle fold), 모든 머리글 접기 (collapse all),
  모든 머리글 펼치기 (expand all).
- Choosing a level **sets** it; choosing the level a heading already has is a
  no-op. The existing `Mod-Alt-N` shortcut **toggles** (pressing it on an `h2`
  produces a paragraph). That divergence is pre-existing behaviour from
  `@tiptap/extension-heading` and is deliberately left alone; the menu's check
  mark is radio semantics and toggling from it would contradict the mark.
- **No new keyboard binding is added.** `Mod-Alt-1`–`6` already exist. Fold
  toggle is click- and menu-driven only, rather than claiming another
  combination that could collide.

### Editing hazards around a fold

Hidden content still occupies document positions, so a selection can cross it.
Two cases need explicit rulings:

- **Backspace/Delete at the boundary of a folded heading unfolds instead of
  deleting.** Otherwise a keypress destroys content the user cannot see. This is
  the same fail-open direction as the identity scheme.
- **Enter at the end of a folded heading's own line unfolds, then lets the
  split proceed.** `splitBlock` inserts its new empty paragraph exactly where
  a folded section's hidden range begins, so an unguarded Enter there leaves
  the user typing into `display: none` content with no visible feedback.
  Unlike Backspace/Delete, nothing here is destructive, so the fix does not
  swallow the keystroke — it unfolds the section and then lets Enter do its
  normal job against the now-visible document, rather than doing nothing but
  revealing content the user still can't type into.
- **Select-all then delete does delete the folded content.** That is the user
  asking for the whole document, and it is undoable.

## Tokens, i18n, accessibility

- Every colour comes from an existing `--bear-*` token. The badge is chrome and
  must read as chrome: `--bear-faint` at rest, `--bear-muted` on hover, never
  `--bear-accent`, which is reserved for links, checkboxes, highlight, selection
  and focus.
- Spacing uses the permitted scale (2 4 8 12 16 24 32 48). An arbitrary value
  needs an allowlist entry with a stated reason.
- All menu strings go through `useT`, with keys added to `en.ts` and `ko.ts`.
  `ko.ts` is typed `Record<TranslationKey, string>`, so a missing translation is
  a compile error and must be translated, never weakened.
- The chevron and badge are buttons with `aria-label` and `aria-expanded`.
  Icons are `aria-hidden` and come from `src/ui/Icon.tsx`, the only permitted
  importer of `lucide-react`.
- The menu is a real menu: `Escape` closes it, focus returns to the badge, and
  it traps focus while open. `ConfirmDialog`'s trap queries `'button'`
  specifically — if this menu contains anything else focusable, it needs a
  standard focusable selector rather than copying that query.

## Testing

The round-trip suite is **blind to all of this** — a folded document and an
unfolded one serialize identically, which is the same blind spot that let a dead
`==highlight==` tokenizer and a live-but-banned underline mark ship in M4. So:

- **Structural assertions**, in a new `headingFold.test.ts`, on the decoration
  set itself and on the plugin state, including that the inline folded marker is
  a widget decoration and never document text: that a fold hides exactly the section's
  blocks and not the next heading, that nesting folds with its parent, that
  identity survives an edit elsewhere in the document, and that a renamed
  heading unfolds rather than folding the wrong section.
- **A schema assertion** that `HeadingFold` adds nothing to
  `getSchema(editorExtensions)`, in the shape `extensions.test.ts` already uses.
- **A round-trip assertion** that a folded note serializes byte-identically to
  the same note unfolded, pinning "the document is never touched".
- **Persistence tests** for the identity matcher, driven by real parsed
  documents rather than hand-written fixtures.
- **Playwright** for hover reveal, the overlay at a narrowed pane width, the
  menu, and the durability round-trip (fold, switch note, return, reload).
  `e2e/appearance.spec.ts` gets the relative assertions — the badge is outside
  the prose column at a wide pane and overlapping it at a narrow one.
- Any new visual surface is checked against `npm run shots` and
  `npm run measure`, not by eye.

Before any e2e run that follows a source change: `lsof -ti:4173 | xargs -r kill -9`.

## Known limits, accepted

- **Renaming a folded heading unfolds it.** Deliberate, and the fail-open
  direction the identity scheme is built around.
- **Two headings with identical level and text, where the user reorders them**,
  will keep the fold attached to the ordinal occurrence rather than to the
  section that moved. Fail-open in the sense that nothing is hidden that the
  user did not fold at that position; not worth a heavier identity scheme.
- **Inserting a new heading identical to an already-folded one, above it,**
  has the same root cause and is the more likely edit of the two — reordering
  requires deliberately moving a section, while this can happen from
  ordinary typing. Fold `## A`, then write a new `## A` above it: the new
  section is occurrence 0 and inherits the fold, while the section the user
  actually folded becomes occurrence 1 and opens. Nothing is hidden that the
  user never folded, but the visible section is not the one they folded
  either. Recoverable — the inline "…" marker on the now-folded section cues
  that something is folded there — and not worth a heavier identity scheme
  for the same reason as the reordering case above.
- **The menu's locale is frozen at mount**, inherited from `RichEditor`'s
  extension array being built once.
- **A folded section is still found by note-list search**, because search reads
  `note.text` and folding never touches it. Opening such a note shows the match
  inside a folded section. Accepted for B1; auto-expanding on a search hit would
  need the editor to learn about the app's query state, which is the boundary
  M7.6 and M7.7 were both careful not to cross.
