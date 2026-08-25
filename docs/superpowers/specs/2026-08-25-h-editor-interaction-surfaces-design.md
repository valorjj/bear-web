# H — Editor interaction surfaces: live state, right-click, palette, table handles

Written 2026-08-25. Sub-project **H**, raised by the user in a fresh session
after using the live app, from three complaints: the toolbar does not know the
caret is inside a highlight, the table bar is "text-written buttons", and the
editor has no right-click.

The letters are `docs/superpowers/NEXT.md`'s and are not milestone ids.
**H is ordered AHEAD of G (PDF export)** by the user's explicit ruling, even
though G's spec and plan were written and committed the same day and H was not
in the queue at all. G is unstarted and stays untouched until H ships.

## Purpose

Four editor control surfaces exist today — the top pill, the bottom pill, the
heading fold gutter, the table bar — and none of them can be reached from the
text the user is actually pointing at. The one that is supposed to reflect the
caret's state does not, and has not since M4.

H does four things:

1. **Fixes the toolbar's state tracking**, which is a live bug, not a polish
   item. See "The defect" below.
2. **Puts the highlight palette at the highlighted text**, on left-click.
3. **Adds a right-click editing menu** to the writing surface.
4. **Replaces the floating table bar with edge handles**, and moves table
   deletion into the right-click menu.

## The defect

`src/features/editor/RichEditor.tsx:162` calls `useEditor({ ... })` with no
`shouldRerenderOnTransaction` option. **In Tiptap v3 that option defaults to
`false`**, and the project is on `@tiptap/react` 3.29.2. The React component
therefore does not re-render when a transaction moves the selection.

Every `active:` entry in `BottomToolbar`'s `ACTIONS` table, and both
`aria-pressed` reads in `TopControls`, call `editor.isActive(...)` **during
render**. With no render, the value is whatever it was when React last had a
reason of its own to run — so the pressed state of Bold, Italic, Highlight,
Table and the rest is stale from the moment the user moves the caret.

This is not a highlight-specific bug. **The whole toolbar has been reporting
stale formatting state since M4**, and no test in the suite can see it: the
component tests click a button and assert the resulting document, and clicking
does not go through React state at all.

`HighlightMenu` looks correct only by accident. `RichEditor.tsx:307-311` does
read the caret's real colour — but the menu is gated on `colorMenuOpen`, and
flipping that is a React state change, which forces the render that makes the
read fresh. Nothing about the read is wrong; everything about when it happens
is luck.

## Decisions already taken

### The fix is a selector subscription, not `shouldRerenderOnTransaction`

`shouldRerenderOnTransaction: true` is the one-line fix and it is rejected.
It re-renders the editor's entire subtree on **every transaction**, which in a
notes app means every keystroke the user types. The bottom toolbar is eleven
buttons and a Fragment each; the top pill, the info panel and the export menu
sit in the same tree.

`useEditorState({ editor, selector })` — verified present in the installed
`@tiptap/react` 3.29.2, not assumed — subscribes to transactions but only
re-renders when the **selected slice** changes by its equality check. A
selector returning a flat flags object re-renders when a format flag flips,
which is exactly the frequency the toolbar needs and no more.

Consequence for the components: `Action.active` stops being
`(editor: Editor) => boolean` and becomes a key into the flags object.
`BottomToolbar` and `TopControls` take the flags as a prop and call
`editor.isActive` nowhere. That is the property worth having — a component
that cannot read live editor state during render cannot go stale again.

### The palette is fixed-positioned React, not a `Decoration.widget`

`tables.md` records the widget reasoning for the table bar: a widget lives
inside the scrolling content, so it tracks its node with no geometry code and
cannot drift on scroll. That reasoning does not transfer here.

A highlight is an **inline mark**. A widget decoration placed inside inline
content is laid out *in the text flow* — it would push the rest of the
sentence sideways for as long as the caret sat in the mark. The palette must
overlay, so it is positioned `fixed` off `editor.view.coordsAtPos(markStart)`,
the mechanism `HeadingMenu` already uses.

`HeadingMenu`'s stated caveat is that fixed positioning is "fine for a menu
that closes on the next click, and wrong for chrome that stays up." The
palette is the second kind, so it must reposition on scroll and on resize —
this is accepted cost, not an oversight, and is called out again under Risks.

### The palette has no open/close state

It is rendered whenever the flags object says a highlight is active at the
caret, and unmounted when it is not. There is no boolean to get out of sync
with the document, which is the failure mode this whole sub-project exists to
remove. Escape moves focus back to the editor; it does not hide the palette
while the caret is still inside the mark.

### The palette carries a REMOVE affordance

There is presently no way to clear a highlight from the text itself: the
toolbar's Highlight button toggles the *last-chosen* colour, and
`HighlightMenu`'s five `menuitemradio` choices deliberately **set** rather
than toggle (`Highlight.ts`'s `setHighlightColor`, and the comment at
`RichEditor.tsx:318-328` explaining why). A palette that can reach five
colours and not "none" would be a worse dead end than the one it replaces.

### `CHOICES` moves to a shared module

`HighlightMenu.tsx`'s `CHOICES` array — colour, label key, and the written-out
Tailwind swatch utility with its warning about template interpolation
compiling to nothing — becomes a shared export consumed by the toolbar menu,
the palette, and the context menu's swatch row. Three copies of a colour
roster is three places for the roster to drift.

### The right-click menu is FLAT — no submenus

Bear's own menu (screenshot supplied 2026-08-25) nests "다음으로 표 복사 ▸"
and "열 맞춤 ▸". This one does not nest. Heading levels render as an inline
`H1…H6` glyph row and highlight colours as an inline swatch row, both inside
the single menu surface.

Hover-intent on a nested flyout — the diagonal-travel problem, the open/close
timers, the keyboard model for entering and leaving a submenu — is a large
class of bugs bought for one saved click. Bear is a reference, not a target.

### The menu carries no clipboard rows

No Cut, no Copy, no Paste. Paste is the reason: a custom menu item cannot
read the clipboard without `navigator.clipboard.readText()`, which is
permission-gated and prompts. A Paste row that either fails or nags is worse
than no Paste row, and offering Cut and Copy without Paste reads as a bug.
`⌘X`/`⌘C`/`⌘V` keep working and are unaffected by any of this.

Consequence the user accepted knowingly: **overriding `contextmenu` on the
writing surface also removes the browser's spellcheck suggestions, Look Up and
Services** from that surface. This is the cost of the feature, recorded here
so it is not rediscovered as a defect.

### The menu has a keyboard route

`Shift+F10` and the Context Menu key open it at the caret's own
`coordsAtPos`. `docs/rulings/accessibility.md` governs; this is not optional
and not a follow-up. The menu is `role="menu"` with roving focus and Escape
returning to the editor, matching `ExportMenu` and `HeadingMenu`.

### The table bar is deleted; handles replace it; deletes move to the menu

The five-button bar goes away entirely. In its place, a `⊕` on each row's left
edge and each column's top edge, revealed on hover, inserting **adjacent to
that specific row or column** — which is the whole point: the control is where
the thing is, and no glyph has to be recalled.

Deletion is not on a hover handle. It becomes a named row in the right-click
menu, which is a **strengthening** of `tables.md`'s destructive-control rule,
not a reversal of it: the words survive, and they move somewhere a
mis-aimed hover cannot reach them.

### Two `tables.md` rulings are amended, deliberately

Both are rewritten in place with their reasoning updated, not silently
contradicted:

- **"Words, not glyphs. Three of these five destroy content…"** — superseded.
  The premise was five buttons on one bar, three of them destructive. There is
  no bar and the destructive three are named rows in a menu.
- **"Adds land AFTER the current row/column, and there is deliberately no
  'before' pair."** — superseded. The stated reason was bar width: "ten
  buttons on a bar that floats over the user's prose is a worse trade than one
  extra keystroke." The bar is gone, so the reason is gone. The menu carries
  insert-above and insert-before; the handles insert adjacent to the edge the
  user pointed at, which needs no direction at all.

### The plugins hand events UP; they never reach for the app

`TableControls`' existing note applies unchanged to both new plugins: a
ProseMirror plugin has a `view`, and therefore a `state`/`dispatch` pair, but
no `Editor`. The `contextmenu` plugin calls `preventDefault()` and invokes an
`onOpenContextMenu({ clientX, clientY, pos })` callback supplied at
construction; React renders the menu. The gutter-handle plugin dispatches
`prosemirror-tables`' own commands directly. This is the boundary
`TagPill.onActivate` and `HeadingFold.onOpenMenu` both keep.

Both callbacks follow the established `null`-means-nobody-is-listening shape
of `TagPillOptions.onActivate` and `TableControlsOptions.labels`: absent
rather than inert, and read once at construction, since the editor is keyed by
note id.

## Architecture

Five units, each independently testable.

### `editorState.ts` (new, `src/features/editor/`)

Exports the selector and the `EditorFlags` type. One function, no React, no
JSX — so the selector's correctness is a plain unit test against a constructed
editor rather than a render test.

```
EditorFlags = {
  bold, italic, strike, highlight, link,
  heading1, taskList, bulletList, orderedList, codeBlock, blockquote, table,
  highlightColor: HighlightColor | null,
  highlightRange: { from, to } | null,
}
```

`highlightRange` is what the palette positions against; it is computed with
the same outward walk `tablePosAt` uses, not by scanning.

### `highlightChoices.ts` (new)

`CHOICES`, moved out of `HighlightMenu.tsx` verbatim, comment included.

### `HighlightPalette.tsx` (new)

Consumes `highlightRange` and `highlightColor`, renders the swatch row plus
remove.

Its callback distinguishes three outcomes, and the middle one is the easy
mistake: `HighlightColor` sets a named colour, **`null` sets the DEFAULT tint**
(the uncoloured `==text==` mark, which `Highlight.ts` deliberately represents
as `color: null` rather than as a sixth roster entry), and **`'remove'` unsets
the mark entirely**. `null` and `'remove'` are not the same outcome and must
not share a value.

Positioning is the caller's — `RichEditor` owns `fixed` placement, the same division
`TopControls` and `BottomToolbar` already keep.

### `ContextMenu.ts` + `EditorContextMenu.tsx` (new)

The plugin (`.ts`) and the surface (`.tsx`). The plugin owns the
`contextmenu` DOM event and the two keyboard openers; the component owns
layout, roving focus, edge flipping and dismissal.

### `TableHandles.ts` (new, replacing `TableControls.ts`)

Widget at the table position rendering an overlay layer; measures the table's
row and cell rects and places the `⊕` buttons. `tablePosAt` moves here
unchanged — it is depended on by the context menu too, so it may end up in a
small shared `tablePos.ts`; the plan decides.

`TableControls.ts` and `tableControls.test.ts` are deleted. `TABLE_ACTIONS`
and `COMMANDS` survive, relocated: the context menu needs all seven commands
and the handles need two of them.

## Testing

**What the unit suite can prove:** the selector's flags for a constructed
document and selection; each palette choice dispatching the right command;
which context-menu rows are present for a caret in prose, in a table, and in
a highlight; each handle and each menu row dispatching the command it claims.

**What it cannot:** every position. jsdom has no layout engine — the same
constraint that put the pointer-drag tests in Playwright and that requires
`RichEditor.test.tsx`'s three `Range`/`elementFromPoint` stubs. `coordsAtPos`,
`getBoundingClientRect` on table rows, and edge flipping are **all**
Playwright.

**New `e2e/editorContext.spec.ts`:** right-click opens ours and suppresses the
browser's; `Shift+F10` opens it at the caret; the palette appears on clicking
into a highlight and follows the caret out; handles track their rows after an
insert; the menu flips at the viewport edge.

**A falsification test for the defect itself.** The stale-state bug shipped
because no test could see it. One must be able to: move the selection
programmatically into a bold run and assert `aria-pressed="true"` on the
toolbar's Bold button **without** any intervening React state change. Reverting
to `editor.isActive` in render must turn it red.

**`npm run shots` gains a context-menu shot**: 14 × 16 = **224 files**, up from
208. Count the files; do not trust the exit code.

## Risks

- **The gutter handles are the expensive piece, and they buy back a property
  the bar had.** `TableControls`' own comment records that the widget shape was
  chosen so the bar would need *no geometry code* and could not drift on
  scroll. Edge handles need exactly that geometry, re-measured on document
  change and on resize. Accepted by the user with the cost stated.
- **The palette is `fixed` chrome that stays up**, which `HeadingMenu`'s
  comment explicitly calls the wrong use of fixed positioning for chrome with a
  lifetime longer than one click. It must reposition on scroll and resize or it
  will drift away from its own text.
- **Overriding `contextmenu` removes spellcheck suggestions** from the writing
  surface. Stated above; repeated here because it is the kind of loss noticed
  weeks later.
- **`e2e` timing.** Several existing e2e tests fail under machine load and the
  failures look like regressions. Check `uptime`, and
  `lsof -ti:4173 | xargs -r kill -9` before trusting any result that follows a
  source change.

## Out of scope

- Column alignment and "copy table as", both in Bear's menu. Not requested.
- Drag-to-reorder rows or columns. B2 covers headings and is still queued;
  table reordering is not named anywhere and is not being added here.
- Anything about export or PDF. **G is next and untouched.**
