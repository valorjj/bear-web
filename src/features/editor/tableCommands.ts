import type { EditorState } from '@tiptap/pm/state';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
} from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';

/**
 * The seven table actions.
 *
 * Grew from five to seven in H. The old set had no "before" pair, and the
 * stated reason was bar width — "ten buttons on a bar that floats over the
 * user's prose is a worse trade than one extra keystroke". There is no bar
 * any more: adds are edge handles that insert adjacent to the edge the user
 * pointed at (so they need no direction at all), and the named directions
 * live in the context menu, where a seventh row costs nothing.
 *
 * `prosemirror-tables`' own commands, not Tiptap's wrappers: a plugin has a
 * `state`/`dispatch` pair but no `Editor`, and reaching for one from inside a
 * plugin would be the editor learning about the layer above it.
 */
export const TABLE_ACTIONS = [
  'addRowBefore',
  'addRowAfter',
  'addColumnBefore',
  'addColumnAfter',
  'deleteRow',
  'deleteColumn',
  'deleteTable',
] as const;

export type TableAction = (typeof TABLE_ACTIONS)[number];

export const COMMANDS: Record<
  TableAction,
  (state: EditorState, dispatch?: EditorView['dispatch']) => boolean
> = {
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
};
