import type { Extensions } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';

import { Highlight } from './Highlight';
import { RawDefinition, RawHtmlBlock, RawImage, RawTable } from './RawBlock';

/**
 * The single source of truth for which Markdown constructs this editor
 * supports. A construct absent from this array is handled by one of the Raw*
 * nodes and survives verbatim; it is never silently dropped.
 *
 * The Raw* entries go last, so any extension above that legitimately claims a
 * token wins over the fallback. Their token set (`table`, `def`, `html`,
 * inline `image`) was derived empirically by running `marked.lexer` over a
 * sample containing each construct and checking which top-level token types
 * no extension above already registers via `markdownTokenName` — see
 * `RawBlock.ts` and the M4 task 5 report.
 */
export const editorExtensions: Extensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
  RawTable,
  RawDefinition,
  RawHtmlBlock,
  RawImage,
];
