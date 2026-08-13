import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { findTagRanges } from '@/data';

import { maskedBlockText } from './blockText';

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
export function tagDecorations(state: EditorState): Decoration[] {
  const decorations: Decoration[] = [];
  const { from: selFrom, to: selTo } = state.selection;

  state.doc.descendants((node, pos) => {
    // `spec.code` is the property this behaviour actually depends on — set by
    // `codeBlock` today — rather than a hardcoded node name, so a rename or a
    // second code-ish node type stays covered.
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    const text = maskedBlockText(node);
    for (const range of findTagRanges(text)) {
      // maskedBlockText emits one character per document position, so the
      // character at index i sits at pos + 1 + i.
      const from = pos + 1 + range.start;
      const to = pos + 1 + range.end;
      // A tag the cursor is inside keeps its plain text, so character widths
      // do not jump while it is being typed or edited. Intersection, not
      // containment: a caret sitting at either edge is still "inside" as far
      // as editing comfort goes.
      if (selFrom <= to && selTo >= from) continue;
      decorations.push(Decoration.inline(from, to, { class: 'bear-tag' }));
    }
    return false;
  });

  return decorations;
}

// Not exported: nothing outside this file needs to target this plugin by
// key. Kept as a `PluginKey` (the `Plugin` constructor takes one) rather than
// an anonymous plugin, for the same debuggability every other plugin in this
// app gets.
const tagPillKey = new PluginKey('tagPill');

export const TagPill = Extension.create({
  name: 'tagPill',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tagPillKey,
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, tagDecorations(state));
          },
        },
      }),
    ];
  },
});
