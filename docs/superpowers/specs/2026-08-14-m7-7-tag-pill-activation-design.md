# M7.7 — Tag Pill Activation

**Status:** approved
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Predecessors:** M5 (tags), M6 (smart lists), M7 (search), M7.6 (tag pills)

## Goal

Make a tag pill act like a tag: activating one filters the note list by it.

## Why

M7.6 made a tag visible while you write it. It is still inert. Bear filters when
you click a tag in the editor, and that is the payoff the pill implies — a
coloured chip that does nothing is a label, not a control.

M7.6 deliberately left this out because the editor plugin would have to know
about the app's scope state, and the boundary that **the editor knows only
about its own document** had been kept clean through five milestones. How to
cross it is this milestone's actual design problem, and the rulings below are
mostly about crossing it narrowly.

## Rulings

### Plain click edits; Mod-click activates

A tag is text the user has to be able to fix. If a plain click always filtered,
correcting a typo in `#wrok` would mean arrowing in from outside — the pill
would defend itself against being edited.

So: **plain click places the caret, exactly as today. Mod-click activates.**

This is a deliberate divergence from Bear, which filters on a plain click.
Bear can afford that because its tag autocomplete makes mistyped tags rare;
this app has no autocomplete (out of scope, see below), so editing a tag in
place is the normal repair path and must stay cheap.

The cost is discoverability, and because the cost is real it is answered by a
ruling of its own rather than left to a tooltip — see *The modifier is
visible before it is used*.

### Mod is Cmd on Apple platforms and Ctrl elsewhere — never both

**Ctrl-click on macOS is the context-menu gesture.** Treating the modifier as
`event.metaKey || event.ctrlKey` means a Mac user who Ctrl-clicks a pill gets
the context menu AND a scope change, from one gesture they meant as one thing.

The modifier is therefore the same "Mod" every keyboard shortcut in this app
already uses: Cmd on Apple, Ctrl everywhere else, resolved by whatever platform
test the editor stack already ships rather than a second hand-rolled one.

Activation also requires the primary button. A middle-click or a right-click
with the modifier held is not an activation.

### The hit test reads the grammar, not the decoration set

A tag whose range intersects a focused editor's selection has **no pill** —
that is M7.6's suppression rule. If activation hit-tested the decoration set,
Mod-clicking a tag the caret happens to sit in would silently do nothing, and
the difference would be invisible: the user sees plain text either way and
cannot tell why the gesture worked a moment ago and not now.

**Behaviour must not depend on invisible state.** So activation hit-tests the
tag ranges themselves: `tagRangeAt(state, pos)` runs the same
`maskedBlockText` + `findTagRanges` pipeline the decorations run, and answers
"is there a tag at this position" regardless of whether one is painted.

This keeps M7.6's central property intact — **the grammar exists in exactly one
place**. A separate "which tag did they click" scan would be a second
implementation of it, which is this project's signature defect class.

### The plugin reports a fact; the app decides what it means

`TagPill` gains one configure option, `onActivate(tag: string)`. The plugin
detects the gesture, returns `true` from ProseMirror's click handler so the
caret does not move, and passes the tag name out. It learns nothing about
scopes, filters, or the sidebar.

The callback threads `AppShell` → `NoteEditor` → `RichEditor` → the extension.
`editorExtensions` stays a module constant, defined as `buildEditorExtensions()`
with no options, so `getSchema(editorExtensions)` and every existing test keep
working untouched; `RichEditor` calls the factory with its callback.

**Two alternatives were considered and rejected.**

*DOM event delegation* — put `data-tag` on the decoration and let `AppShell`
handle clicks on its own container, so the editor learns nothing at all. It
does not work: ProseMirror places the selection on `mousedown`, before a
delegated `click` listener runs, so the caret jumps into the tag, suppression
lifts the pill, and the thing the user clicked disappears under the cursor.
Only code inside the editor's own handler chain can prevent that.

*A `CustomEvent` dispatched by the plugin* — same detection and prevention, no
prop threading. Rejected for being stringly-typed: nothing checks that the
listener and the dispatcher agree, and this project already carries enough
rules that only prose enforces. The prop costs one line in each of two
components, and this app already threads `handleRef` in the same direction.

### The modifier is visible before it is used

While Mod is held, pills read as controls: `cursor: pointer` and a stronger
fill. Someone who holds Cmd for any reason — on the way to Cmd-B — sees every
pill in the note answer, which teaches the gesture without a word of copy. A
`title` on each pill names it for anyone who hovers.

**The failure mode is a stuck affordance**, and it is the reason this is a
ruling rather than a detail. Hold Cmd, press Tab to switch windows, and the
`keyup` never arrives: the class stays on, pills claim to be clickable, and a
plain click then edits instead. So the state is derived from each event's own
`metaKey`/`ctrlKey` on both `keydown` and `keyup` rather than from tracking
which key went down, and it is cleared on window `blur`. A test must be able to
fail on the stuck case.

### An unknown tag activates nothing

M7.6 ships two documented classes of **lying pill** — a tag ending link text,
and a mark applied over leading whitespace the serializer hoists. In both the
pill is painted and the tag is not in the index.

Activating one would set a scope for a tag that does not exist, and
`AppShell`'s vanished-tag fallback would immediately eject the user back to All
Notes: a click that visibly throws you somewhere you did not ask to go.

So the handler checks the tag tree first and does nothing when the tag is
absent — including while the tree is still loading, since `useTagTree` returns
`undefined` before its live query resolves and treating that as "no tags" is
the same mistake the vanished-tag guard already exists to avoid.

### Activation reveals the row it selects

The note list has **no header naming the current scope**; the only on-screen
indication is the `aria-current` row in the sidebar. A nested tag whose parent
is collapsed has no rendered row at all, so activating `#work/urgent` while
`work` is collapsed would filter the list with nothing anywhere explaining why.

`useTagTree` gains `reveal(tag)`, which clears the collapsed flag on the tag's
ancestors — reusing the durable per-tag setting `toggle` already writes. It is
a no-op when nothing is collapsed.

A scope header for the note list is the more general fix and is **out of
scope**: the gap predates this milestone, it is a new piece of UI rather than a
change to an existing one, and it belongs with M8's polish.

## Scope

**In:** `tagRangeAt`, the `onActivate` option and its threading, the modifier
affordance, the unknown-tag guard, `reveal`, and tests.

**Out:**

- **A keyboard path to activation.** Making a span inside a contenteditable
  focusable is a known trap — it fights the editor for the selection and for
  Tab — and the tag sidebar is already a complete keyboard route to every
  filter. Recorded as a deliberate ruling, not an omission.
- **A scope header for the note list.** See above; M8.
- **Tag rename and delete**, still carried from M5b and still unscheduled.
- **Autocomplete while typing `#`.** A separate feature with its own
  interaction design. Its absence is *why* plain click must keep editing.
- **Syntax-visibility toggling**, still carried and unscheduled.

## Testing

**Unit, on `tagRangeAt`:** the tag at a position inside a tag, at each edge,
and `null` for a position in ordinary prose, inside a code span, and inside a
code block. It must agree with what `tagDecorations` would paint for the
unsuppressed case — the two read the same scan and a test should hold them to
it.

**Structural, on the plugin.** The click handler is the whole feature and a
decoration test cannot see it. Assert that a Mod-click inside a tag calls
`onActivate` with the tag name and returns `true`, that a plain click returns
`false` and calls nothing, that a Mod-click outside any tag returns `false`,
and that a non-primary button does not activate. The macOS Ctrl-click case
needs its own assertion, because getting it wrong is invisible on Linux CI.

**Suppression independence:** a Mod-click on a tag whose pill is currently
suppressed still activates. This is the assertion that pins "behaviour does not
depend on invisible state".

**Component:** `AppShell` sets a tag scope on activation, does nothing for a
tag absent from the tree, and does nothing while the tree is `undefined`.
`RichEditor` passes a *current* callback rather than the one captured at mount.

**The affordance:** a test that fails when the modifier class survives a window
blur. Per M7.5's standing rule, an assertion that cannot be made to fail does
not go in.

**End to end, in a real browser:** Mod-click a pill and the note list filters
and the sidebar row reads as current; plain-click a pill and the caret lands in
the tag with the scope unchanged. Both belong in `e2e/` because jsdom cannot
drive a real modifier-click through ProseMirror's coordinate mapping.

## Risks

**The caret moving anyway.** The whole gesture depends on returning `true` from
the right handler at the right point in ProseMirror's chain. If the selection
still moves, suppression lifts the pill the user just clicked. This is the
first thing to verify in a browser, not the last.

**A second grammar creeping in.** `tagRangeAt` must be a view over the existing
scan, not a new one. M7.6's whole architecture rests on there being one.

**Recomputation on click.** The decorations already re-scan every transaction;
a click adds one more scan of one block. The whole-branch review measured 2.6 ms
for a 100 KB note, so a per-click scan of a single block is far below
perceptible — but it should be a single block, not the document.
