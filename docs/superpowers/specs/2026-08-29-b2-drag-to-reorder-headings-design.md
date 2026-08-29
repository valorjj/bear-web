# B2 — Drag-to-reorder headings

Written 2026-08-29. Sub-project **B2**, the half deliberately split out of
**B** when B1 shipped on 2026-08-21. B1's spec is
`docs/superpowers/specs/2026-08-20-b1-collapsible-headings-design.md`, and its
"Out of scope" section names this one.

The letter is `docs/superpowers/NEXT.md`'s and is not a milestone id.

## Purpose

A note's structure is currently write-once. A heading and everything under it
can be folded (B1), given a level (B1), and deleted — but it cannot be **moved**.
Reordering a section today means selecting it by hand across a fold boundary,
cutting, placing a caret somewhere else, and pasting, which is exactly the
operation that a heading-dense note makes hardest.

B2 adds one capability — *move a heading and the whole subtree it owns* — and
reaches it three ways: a pointer drag on the level badge, two items in the
right-click editor menu, and a keyboard binding.

The three routes exist because **the gutter can never be keyboard-reachable**.
`docs/rulings/accessibility.md` records seven measurements establishing that
Chromium refuses `.focus()` to every descendant of a heading once that heading
contains a `Decoration.widget` — which is why B1 shipped `Mod-Alt-F` rather
than a focusable chevron. A drag handle inherits that constraint whole. Shipping
only the gesture would make reordering the one capability in this app with no
non-pointer path to it, which B1 deliberately avoided.

## Decisions already taken

Recorded here because each closes a question that would otherwise be reopened
during implementation.

### The handle is the badge, and it cannot be a new control

The gutter is exactly full. `docs/rulings/design-tokens-and-layout.md` records
that the toggle sits at `-3rem` and the badge at `-1.5rem`, each `1.5rem` wide,
*adjacent with no gap* — and `editor.css`'s touch-target block explains that
this is why J2 could only give them 24×44 rather than 44×44 hit areas. A third
gutter control would have to overlap a neighbour or push into the measure. So
the drag handle is the badge that is already there.

### Drop targets are section boundaries, and the level never changes

The valid drop positions are the gaps between top-level sections: every
section's `pos`, plus `doc.content.size`. Nothing may be dropped above the
note's first block, which renders as the title and is not a section at all —
`headingSections` already excludes it, and `deriveTitle` already treats that
line as the note's name.

The dragged heading **keeps its level**. Re-levelling on drop was considered and
rejected: it silently rewrites a document's structure, and it makes undo restore
a level the user never set. Nothing is lost by declining it, because
`headingSections` defines section ownership by level already — an `h3` dropped
after an `h2` simply becomes that `h2`'s first subsection, with no code.

Dropping *inside* another section's body — between two of its paragraphs — was
also rejected. It produces a document whose headings no longer partition it, so
the user's model of "sections" stops matching what `headingSections` computes.

### The move is one transaction, and therefore one undo step

Delete `[S.pos, S.end)`, reinsert the slice at the boundary. When moving
downward the target is shifted left by the slice's size, because the deletion
happens first. `history` groups by transaction, so a single `tr` gives a single
`⌘Z` that restores both position and folds. This is why the fold remapping
below must ride the same transaction rather than following it.

### Folds must be remapped, and this is the one non-obvious hazard

B1's fold identity is `{ level, text, nth }` — content-derived on purpose, so a
fold survives the keyed remount that a note switch forces. `nth` is the
occurrence index among headings sharing a level and text.

**Moving a section changes `nth` for every heading that shares its level and
text.** With two `## Notes` sections, folding the second and dragging it above
the first leaves the stored key `2:1:Notes` pointing at what is now the *other*
section: the one the user folded springs open and the one they never touched
collapses. B1's fail-open rule does not protect against this, because the key
still matches something — it fails *closed*, in the wrong direction.

So the move computes the post-move section list analytically, maps every folded
key from its old identity to its new one, and carries the result in the same
transaction through the existing `setKeys` meta. This gets a unit test with a
deliberately duplicate-titled fixture; it is the defect most likely to ship
unnoticed, because every fixture with unique headings passes without the
remapping existing at all.

### Touch gets the capability, not the gesture

The drag binds for `pointerType` of `mouse` or `pen`. A touch pointer falls
straight through to today's behaviour — the badge opens the `≡N` menu.

Three reasons, in order of weight. The handle is 24px wide on a coarse pointer
and J2 could not widen it. Drag-versus-scroll disambiguation and edge
auto-scroll are hardest on precisely the surface where the target is smallest.
And the OS already owns press-and-hold inside a `contenteditable`, which
`editor.css` records as the reason the gutter is permanently visible under
`@media (hover: none)` rather than long-press-revealed.

Touch users reach the same move through the context menu, which a long press
inside the editor already opens.

### The menu items live in the context menu, not the badge menu

The badge's `≡N` menu opens **only** by clicking the badge, which is a
mouse-only widget; `Mod-Alt-F` folds and does not open it. Putting the move
items there would add no keyboard route at all.

`EditorContextMenu` answers `Shift+F10` (see `docs/rulings/accessibility.md`),
so a **Section** group there is a genuine keyboard and screen-reader route. The
badge menu is left exactly as it is — fold, and the six levels.

Putting the items in both menus was rejected: two copies of the same two items
with two copies of their enable conditions is the duplicated grammar this
project avoids elsewhere (`parseTags`/`findTagRanges`).

### The binding is `Mod-Alt-ArrowUp` / `Mod-Alt-ArrowDown`

Symmetric with `StoredImage`'s shipped `Mod-Alt-ArrowLeft` / `Mod-Alt-ArrowRight`,
which resize an image. Verified against `node_modules/@tiptap` — nothing binds
either chord — as B1's ruling requires: a new binding is checked against the
package, not only against browser shortcuts, because Tiptap's reversed extension
order lets a later extension silently win.

## Architecture

### `src/features/editor/headingReorder.ts` — new, pure

Everything that can be tested without a pointer:

- `dropBoundaries(doc): number[]` — the positions a section may start at.
- `moveSectionTransaction(state, fromPos, toBoundary): Transaction | null` —
  the slice-and-reinsert, with the fold remapping applied via `setKeys` meta on
  the same `tr`. Returns `null` for a boundary inside the moved range and for
  the two boundaries that are no-ops (`S.pos` and `S.end`), so a rejected drop
  is a distinguishable value rather than a transaction that changes nothing.
- `remapFoldKeys(before, after, folded): string[]` — old identities to new.

It imports `headingSections`, `foldKeyOf` and `serializeFoldKey` and owns no
DOM, no React and no options.

### `src/features/editor/HeadingFold.ts` — the gesture

The badge's behaviour stays where the badge's rendering is. The existing
`handleDOMEvents.mousedown` becomes a pointer-event trio, and the menu opens on
**release** rather than on press:

1. `pointerdown`, left button, on `[data-fold-badge]` → `preventDefault`,
   `setPointerCapture`, record `{ pos, x, y }`. No menu, no transaction.
2. `pointermove` past a 4px threshold, `pointerType` in `mouse | pen` → enter
   drag. Boundary screen positions are measured **once at drag start** with
   `view.coordsAtPos`; the nearest to the pointer's Y wins. A folded section's
   body is `display: none`, but a heading never is, so every boundary is
   measurable.
3. `pointerup` → commit the move if dragging, otherwise call `onOpenMenu`
   exactly as today.
4. `Escape` and `pointercancel` → abort, dispatching nothing.

Auto-scroll runs while the pointer is within 40px of the scroller's top or
bottom edge. A section drag on a long note is the case this feature exists for,
so a drag that cannot leave the viewport would not deliver it.

Drag state is plugin state, and produces two decorations: a `Decoration.widget`
at the target boundary drawing a 2px `--bear-accent` rule across the measure
(`contenteditable="false"`, `aria-hidden`), and a `Decoration.node` dimming the
section being dragged. B1's `pos + 1` widget rule does **not** apply to it: that
rule exists so a fold widget becomes a child of its heading element, and this
widget sits at a top-level boundary between blocks, deliberately outside any of
them.

**The toggle is not a drag handle.** Only the badge is.

### Commands and the menu

- `moveHeadingSection(fromPos, toBoundary)` — the low-level command.
- `moveHeadingSectionUp()` / `moveHeadingSectionDown()` — resolve the section
  from the caret, no-op at the ends. Bound to `Mod-Alt-ArrowUp` /
  `Mod-Alt-ArrowDown`, and returning `false` when the caret is in no section so
  the keystroke falls through rather than being swallowed — the rule
  `Mod-Alt-f` already follows.
- `EditorContextMenu` gains a `Section` group with the two items, rendered only
  when the caret is inside a top-level section, each disabled at its end of the
  document. New `editor.section.*` keys in `en.ts` and `ko.ts`.

## Testing

**Unit — `headingReorder.test.ts`.** Boundaries, the move in both directions,
the three rejected drops, the fold remapping against a duplicate-titled fixture,
the two commands' resolution from a caret and their no-op at the ends, and that
one `⌘Z` restores order *and* folds. None of this needs a pointer.

**Component — `contextMenu.test.ts`.** The Section group appears only inside a
section, and each item is disabled at the corresponding end.

**Playwright — `e2e/headingReorder.spec.ts`**, the only harness that can see the
gesture at all, since jsdom has no `setPointerCapture`:

- drag a section over another and assert the note's serialized text order;
- the drop indicator is visible during the drag and gone after it;
- `Escape` mid-drag leaves the document untouched;
- a **folded** section moves with its hidden body, and stays folded;
- a coarse pointer opens the menu and does **not** drag;
- a drag near the pane edge scrolls.

Per this project's review standard, each new test is demonstrated failing
against a deliberately sabotaged implementation before it is trusted —
`docs/rulings/testing-and-tooling.md` records three near-vacuous assertions from
sub-project H that passed against sabotage.

## Out of scope

- **Reordering by dragging anything but the badge.** No drag from the heading
  text (it fights text selection inside a `contenteditable`) and none from the
  fold toggle.
- **Moving a section between notes.** The drag is bounded by one document.
- **Re-levelling on drop**, and **dropping inside another section's body** —
  both rejected above with reasons.
- **The touch gesture.** Deliberately declined, not deferred; if it is ever
  wanted it is J4's, which already owns phone chrome.
- **A drag handle on non-heading blocks** (paragraphs, tables, callouts). B2 is
  about document structure, not about arbitrary block movement.

## Risks

- **`HeadingFold.ts` reaches roughly 810 lines.** Accepted deliberately: the
  badge's rendering and its behaviour stay in one file rather than splitting one
  gesture across two plugins that would then contend for the same event. The
  heavy logic is in `headingReorder.ts` with unit tests.
- **`coordsAtPos` measured once at drag start goes stale if the document
  scrolls.** Auto-scroll moves the scroller under a fixed measurement. The
  boundaries are therefore stored in *document* scroll coordinates, not viewport
  coordinates, and the pointer's Y is converted before comparison.
- **The fold remapping is invisible to every fixture with unique headings**, and
  so is the bug it prevents. This is why the duplicate-titled fixture is named
  as a requirement above rather than left to the implementer's judgement.
