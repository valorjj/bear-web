import type { Extensions } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';

import { Highlight } from './Highlight';

/**
 * The single source of truth for which Markdown constructs this editor
 * supports. A construct absent from this array is handled by RawBlock and
 * survives verbatim; it is never silently dropped.
 */
export const editorExtensions: Extensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
];
