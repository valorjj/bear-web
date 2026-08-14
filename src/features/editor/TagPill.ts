import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { findTagRanges } from '@/data';

import { maskedBlockText } from './blockText';

export interface TagHit {
  /** The normalized tag name, exactly as `parseTags` would report it. */
  tag: string;
  /** Document position of the opening `#`. */
  from: number;
  /** Document position one past the tag's last character. */
  to: number;
}

/**
 * Every tag in a textblock, as document positions.
 *
 * The single place the offset arithmetic lives: `maskedBlockText` emits one
 * character per document position, so the character at index `i` inside a
 * block starting at `blockPos` sits at `blockPos + 1 + i`.
 */
function tagHitsIn(node: Node, blockPos: number): TagHit[] {
  return findTagRanges(maskedBlockText(node)).map((range) => ({
    tag: range.tag,
    from: blockPos + 1 + range.start,
    to: blockPos + 1 + range.end,
  }));
}

/**
 * Renders `#tag` as a pill.
 *
 * A decoration, never a mark: the document is untouched, so no schema,
 * serializer or round-trip path is involved, and a pill can never survive
 * into a note's Markdown. Tags are derived from text; the text stays plain.
 *
 * The consequence is that every round-trip test in this project is blind to
 * whether this plugin runs at all — see `tagPill.test.ts`, which asserts on
 * the decoration set itself.
 */
export function tagDecorations(state: EditorState, focused = true): Decoration[] {
  const decorations: Decoration[] = [];
  const { from: selFrom, to: selTo } = state.selection;

  state.doc.descendants((node, pos) => {
    // `spec.code` is the property this behaviour actually depends on — set by
    // `codeBlock` today — rather than a hardcoded node name, so a rename or a
    // second code-ish node type stays covered.
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    for (const hit of tagHitsIn(node, pos)) {
      const { from, to } = hit;
      // A tag the cursor is inside keeps its plain text, so character widths
      // do not jump while it is being typed or edited. Intersection, not
      // containment: a caret sitting at either edge is still "inside" as far
      // as editing comfort goes.
      //
      // Gated on focus: an unfocused editor still has a selection (a fresh
      // note opens with one at position 1), but there is no caret on screen
      // and so nothing for this rule to keep comfortable. Without this gate,
      // a note seeded with a leading tag — exactly what creating a note
      // inside a tag scope does — opened with that tag permanently unpilled,
      // pill or no click. `focused` defaults to `true` so every existing
      // direct call to `tagDecorations(state)` in this file's tests keeps
      // exercising suppression exactly as before; only the mounted extension
      // below ever passes `false`.
      if (focused && selFrom <= to && selTo >= from) continue;
      decorations.push(Decoration.inline(from, to, { class: 'bear-tag' }));
    }
    return false;
  });

  return decorations;
}

/**
 * The tag covering `pos`, or `null`.
 *
 * Deliberately independent of the decoration set: a tag the caret sits inside
 * has no pill (see the suppression rule in `tagDecorations`), and if
 * activation hit-tested the pills instead of the grammar, the same gesture
 * would work or not work with nothing on screen to explain the difference.
 * Behaviour must not depend on invisible state.
 */
export function tagRangeAt(state: EditorState, pos: number): TagHit | null {
  let found: TagHit | null = null;

  state.doc.descendants((node, blockPos) => {
    if (found !== null) return false;
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    for (const hit of tagHitsIn(node, blockPos)) {
      if (pos >= hit.from && pos <= hit.to) {
        found = hit;
        break;
      }
    }
    return false;
  });

  return found;
}

// Not exported: nothing outside this file needs to target this plugin by
// key. Kept as a `PluginKey` (the `Plugin` constructor takes one) rather than
// an anonymous plugin, for the same debuggability every other plugin in this
// app gets.
const tagPillKey = new PluginKey('tagPill');

export const TagPill = Extension.create({
  name: 'tagPill',

  addProseMirrorPlugins() {
    // Captured once, not read as `this.editor` inside the prop below: the
    // `decorations` prop is invoked by ProseMirror's view machinery with no
    // guarantee of `this` binding to the extension instance.
    const { editor } = this;
    return [
      new Plugin({
        key: tagPillKey,
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, tagDecorations(state, editor.isFocused));
          },
        },
      }),
    ];
  },
});
