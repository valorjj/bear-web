import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

/**
 * The single source of truth for which Markdown constructs this editor
 * supports. A construct absent from this array is handled by RawBlock and
 * survives verbatim; it is never silently dropped.
 */
export const editorExtensions: Extensions = [StarterKit];
