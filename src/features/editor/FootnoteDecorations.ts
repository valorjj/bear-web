import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { footnoteNumbers } from './footnoteNumbers';

const footnoteKey = new PluginKey('footnoteDecorations');

/** One decoration per marker and per definition, carrying its number. */
function decorationsFor(state: EditorState): Decoration[] {
  const numbers = footnoteNumbers(state.doc);
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteRef') {
      const label = String(node.attrs.label ?? '');
      decorations.push(
        Decoration.widget(pos + 1, () => text('bear-footnote-number', numberFor(numbers, label)), {
          side: -1,
          // Chrome, not content: a selection running over the marker must not
          // be affected by the number drawn inside it.
          ignoreSelection: true,
          key: `footnote-ref-${label}-${numbers.get(label) ?? 'x'}`,
        }),
      );
      return false;
    }

    if (node.type.name === 'footnoteDefinition') {
      const label = String(node.attrs.label ?? '');
      decorations.push(
        Decoration.widget(
          pos + 1,
          () => text('bear-footnote-def-marker', `${numberFor(numbers, label)}. `),
          {
            side: -1,
            ignoreSelection: true,
            key: `footnote-def-${label}-${numbers.get(label) ?? 'x'}`,
          },
        ),
      );
      return false;
    }

    return true;
  });

  return decorations;
}

/**
 * An unreferenced definition keeps its LABEL rather than taking a number.
 * A number is a reference's property; a footnote nobody points at has no
 * position in the sequence, and the label is what lets the writer find it.
 */
function numberFor(numbers: Map<string, number>, label: string): string {
  return String(numbers.get(label) ?? label);
}

function text(className: string, content: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.contentEditable = 'false';
  element.textContent = content;
  return element;
}

/**
 * Paints footnote numbers in the editor.
 *
 * Recomputed on every `decorations()` call rather than cached in plugin state.
 * The walk is one pass over a document that already fits in memory, and a
 * cache keyed on anything less than the whole document is how a number goes
 * stale after an edit two paragraphs away — which is the entire failure this
 * construct is prone to, since a marker inserted anywhere renumbers everything
 * after it.
 *
 * The same `footnoteNumbers` serves `renderNoteBody`, so what a reader sees
 * here and what an export contains cannot diverge.
 */
export const FootnoteDecorations = Extension.create({
  name: 'footnoteDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: footnoteKey,
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, decorationsFor(state));
          },
        },
      }),
    ];
  },
});
