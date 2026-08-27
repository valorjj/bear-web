import { getMarkRange } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

import type { CalloutType } from './callouts';
import type { HighlightColor } from './Highlight';

/**
 * Everything the editor's chrome needs to know about the caret, as one flat
 * object.
 *
 * Flat and primitive-valued on purpose: `useEditorState` compares the selected
 * slice with `fast-deep-equal` and re-renders only when it differs, so a
 * selector returning a fresh `Selection` or a node instance would re-render on
 * every transaction and defeat the whole point. Every field here is a boolean,
 * a string-union, or a two-number object.
 */
export interface EditorFlags {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: boolean;
  highlight: boolean;
  heading1: boolean;
  /** The heading level under the caret, or `null` when it is not a heading. */
  headingLevel: number | null;
  taskList: boolean;
  bulletList: boolean;
  orderedList: boolean;
  codeBlock: boolean;
  blockquote: boolean;
  /**
   * The callout type under the caret, or `null` for a plain quote or no quote
   * at all. `blockquote` above says WHETHER there is a quote; this says which
   * kind, and the two are read together by the chevron menu.
   */
  calloutType: CalloutType | null;
  table: boolean;
  /** `null` means the DEFAULT tint (`==text==`), NOT "no highlight". */
  highlightColor: HighlightColor | null;
  /** Document range of the highlight under the caret; the palette's anchor. */
  highlightRange: { from: number; to: number } | null;
}

/**
 * The flags for "there is no editor". Used wherever `editor` is `null`, so no
 * consumer has to branch on nullability to read a flag.
 */
export const EMPTY_FLAGS: EditorFlags = {
  bold: false,
  italic: false,
  strike: false,
  link: false,
  highlight: false,
  heading1: false,
  headingLevel: null,
  taskList: false,
  bulletList: false,
  orderedList: false,
  codeBlock: false,
  blockquote: false,
  calloutType: null,
  table: false,
  highlightColor: null,
  highlightRange: null,
};

/**
 * The single source of formatting state for every editor surface.
 *
 * This exists because `useEditor` does NOT re-render on transactions in Tiptap
 * v3 — `shouldRerenderOnTransaction` defaults to `false`. Every `isActive()`
 * call made during a React render is therefore stale from the moment the caret
 * moves, which is the bug that shipped in M4 and survived to H.
 *
 * `shouldRerenderOnTransaction: true` is the one-line alternative and is
 * rejected: it re-renders the editor's whole subtree on every keystroke.
 */
export function editorFlagsSelector({ editor }: { editor: Editor }): EditorFlags {
  const highlight = editor.isActive('highlight');
  const highlightType = editor.schema.marks.highlight;

  // Resolved from the caret rather than from the selection's own `from`/`to`,
  // so a collapsed cursor anywhere inside the mark yields the whole mark.
  const range =
    highlight && highlightType !== undefined
      ? (getMarkRange(editor.state.selection.$from, highlightType) ?? null)
      : null;

  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    link: editor.isActive('link'),
    highlight,
    heading1: editor.isActive('heading', { level: 1 }),
    headingLevel: editor.isActive('heading')
      ? (editor.getAttributes('heading').level as number)
      : null,
    taskList: editor.isActive('taskList'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    codeBlock: editor.isActive('codeBlock'),
    blockquote: editor.isActive('blockquote'),
    calloutType: editor.isActive('blockquote')
      ? ((editor.getAttributes('blockquote').callout as CalloutType | null) ?? null)
      : null,
    table: editor.isActive('table'),
    highlightColor: highlight
      ? ((editor.getAttributes('highlight').color as HighlightColor | null) ?? null)
      : null,
    // Rebuilt as a plain object, never passed through: `getMarkRange` returns a
    // fresh object each call, and `fast-deep-equal` compares by value, so a
    // plain `{from, to}` compares equal across transactions that did not move
    // the mark. Returning the library's object would work too; stating the
    // shape here is what pins it as two numbers and nothing more.
    highlightRange: range === null ? null : { from: range.from, to: range.to },
  };
}
