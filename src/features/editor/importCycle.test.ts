// The FIRST import must be `./extensions`, and that is the whole point of
// this file. Task 3 closed a cycle `extensions.ts -> MarkdownPaste.ts ->
// markdown.ts -> extensions.ts`, and because `markdown.ts` builds its
// manager and schema from `editorExtensions` at module top level, evaluating
// `extensions.ts` first left that binding undefined and the app did not
// boot. All six gates passed: nothing else in the suite happens to import
// these two in this order.
//
// What this catches and what it does not: it reproduces THAT order, not any
// future cycle in another direction. A static cycle check over
// `src/features/editor/` would be stronger and is recorded as follow-up.
import { editorExtensions } from './extensions';

import { describe, expect, it } from 'vitest';

import { getSchema } from '@tiptap/core';

describe('module initialisation order', () => {
  it('leaves editorExtensions fully initialised when imported before markdown.ts', () => {
    expect(Array.isArray(editorExtensions)).toBe(true);
    expect(editorExtensions.length).toBeGreaterThan(0);
  });

  it('can build a schema from it, which is what markdown.ts does at module scope', () => {
    expect(() => getSchema(editorExtensions)).not.toThrow();
  });
});
