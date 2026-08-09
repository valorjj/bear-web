import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';

import { editorExtensions } from './extensions';

/**
 * The only module in the project that imports `@tiptap/markdown`.
 *
 * The manager is driven standalone — no `Editor`, no DOM — so the round-trip
 * suite runs without jsdom's contenteditable limitations and stays fast enough
 * to be exhaustive. That isolation is the point: serialization is the one
 * component whose failure corrupts notes silently.
 */
const manager = new MarkdownManager({ extensions: editorExtensions });

/**
 * What an empty document serializes to. Its exact value is a property of the
 * serializer, pinned by `stability.test.ts` and established by the Task 1
 * spike — not assumed.
 *
 * The blank-note discard rule compares against this constant. That keeps the
 * rule exactly one comparison, which was M3's stated guarantee and survives the
 * editor swap: no trim, no dirty flag, no heuristic.
 */
export const EMPTY_DOCUMENT_MARKDOWN = '';

export function parseMarkdown(markdown: string): JSONContent {
  return manager.parse(markdown) as JSONContent;
}

export function serializeMarkdown(doc: JSONContent): string {
  return manager.serialize(doc);
}

/** `serializeMarkdown(parseMarkdown(md))`. The round-trip under test. */
export function normalizeMarkdown(markdown: string): string {
  return serializeMarkdown(parseMarkdown(markdown));
}
