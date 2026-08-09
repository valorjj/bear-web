import { AllSelection, TextSelection } from '@tiptap/pm/state';
import type { Command } from '@tiptap/core';

/**
 * Fixes a real data-corrupting bug: repeatedly (or differently) toggling a
 * block-level action — checklist, bullet/ordered list, code block, quote —
 * after selecting the whole document grew the note without bound. Two
 * clicks of the same button, which should toggle a format on and back off,
 * instead left a second, empty list item behind; a third click added a
 * third; mixing two block actions nested and duplicated structure instead
 * of replacing it.
 *
 * Root cause: ProseMirror's `AllSelection` (what `editor.commands.selectAll()`
 * produces) is not a fixed range. Unlike an ordinary `TextSelection`, its
 * `map()` unconditionally returns a *new* `AllSelection` spanning whatever
 * the document is *now* — it never shrinks back to "the content that was
 * selected when the user clicked." Every toolbar action runs
 * `editor.chain().focus().<toggle>().run()`, and clicking a toolbar button
 * blurs the editor, so `.focus()` — called with no explicit position — just
 * restores `editor.state.selection` as-is. If that selection is an
 * `AllSelection`, restoring it changes nothing observable... except that the
 * *previous* click's `TrailingNode` (from `@tiptap/starter-kit`, already in
 * `editorExtensions` — it appends an empty paragraph after a block like a
 * list or code fence so the user has somewhere to click below it) is now
 * part of "the whole document." The next click's toggle command wraps that
 * trailing paragraph too, which gets its own new trailing paragraph, and
 * the cycle repeats forever. Confirmed directly against `editor.getJSON()`
 * and `editor.state.selection`, not guessed: an ordinary partial or
 * collapsed `TextSelection` never exhibited this — only `AllSelection` did,
 * because only `AllSelection.map()` refuses to stay anchored.
 *
 * The fix pins an `AllSelection` to a concrete `TextSelection` over the same
 * bounds before the action runs. A `TextSelection` whose `to` sits at the
 * pre-toggle document end does not expand to include content appended after
 * it — verified: doing this immediately before each toggle makes repeated
 * and mixed toggles stop growing the document.
 *
 * This keeps `TrailingNode` exactly as it is — disabling it would trade away
 * real UX (clicking below a list or code block to keep typing) to fix a bug
 * that has nothing to do with it; the extension is working as designed, and
 * the defect is entirely in how the toolbar restored a stale selection.
 *
 * Implemented as a chain step (`.command(pinAllSelectionStep)`), not a
 * separate `editor.commands.setTextSelection(...)` call, deliberately: a
 * standalone call dispatches its own transaction, and jsdom cannot compute
 * `coordsAtPos` for the resulting scroll-into-view — a second, independent
 * dispatch inside a test that clicks a toolbar button more than once made
 * `vitest run` exit 1 even though every assertion passed (this project's
 * established "clicking outside the editor is clean" boundary is specific
 * to the *single*-dispatch-per-click shape `.chain()...run()` already had).
 * Folding the fix into the same chain keeps it at one dispatch per click,
 * exactly like every action already was.
 */
export const pinAllSelectionStep: Command = ({ tr, state }) => {
  if (state.selection instanceof AllSelection) {
    const { from, to } = state.selection;
    tr.setSelection(TextSelection.create(tr.doc, from, to));
  }
  return true;
};
