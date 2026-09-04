// The FIRST import must be `./extensions`, and that is the whole point of
// this file. Task 3 closed a cycle `extensions.ts -> MarkdownPaste.ts ->
// markdown.ts -> extensions.ts`, and because `markdown.ts` builds its
// manager and schema from `editorExtensions` at module top level, evaluating
// `extensions.ts` first left that binding undefined and the app did not
// boot. All six gates passed: nothing else in the suite happens to import
// these two in this order.
//
// What this catches and what it does not: it reproduces THAT order, not any
// future cycle in another direction. The stronger check this comment used to
// ask for now exists — `scripts/sourceLint.test.ts`'s "has no runtime import
// cycles" walks the whole of `src/` and fails on a cycle in any direction.
//
// This file is kept alongside it rather than replaced, because the two prove
// different things. The static check reads the import GRAPH; this one actually
// EVALUATES the modules in the fatal order and asserts the binding survived.
// A graph check cannot see that `markdown.ts` builds from `editorExtensions`
// at module scope, which is the property that turns a cycle into a blank page.
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
