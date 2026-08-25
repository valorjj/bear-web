import type { EditorState } from '@tiptap/pm/state';

/**
 * The document position of the table the selection is inside, or `null`.
 *
 * Walks OUTWARD from the cursor rather than scanning the document, so a table
 * nested in a blockquote or a list item resolves to itself and not to an
 * ancestor. The innermost match wins because `$from.node(depth)` is checked
 * from the deepest depth up.
 */
export function tablePosAt(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return $from.before(depth);
  }
  return null;
}
