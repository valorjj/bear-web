import { Editor, getSchema, resolveExtensions } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES } from './codeLanguages';
import { editorExtensions } from './extensions';
import { lowlight } from './lowlight';
import { normalizeMarkdown } from './markdown';

/**
 * Underline is a SCHEMA-level rule, and it must be asserted at the schema.
 *
 * The spec dropped underline because it has no Markdown representation and
 * `_underline_` collides with CommonMark italic; serializing it to raw `<u>`
 * was considered and rejected. Neither of those shipped. `StarterKit` registers
 * `@tiptap/extension-underline` by default, so the mark was in the schema all
 * along: `Mod-U` worked in the shipped editor and persisted `++text++`, and `u`
 * landed in the schema-derived `recognizedHtmlTags`, which rewrote `<u>x</u>`
 * in an existing note to `++x++` instead of preserving it verbatim.
 *
 * The only test guarding the rule checked that no underline BUTTON was
 * rendered. A missing button says nothing about the schema, the keymap, or the
 * serializer — which is exactly why this shipped through twelve task reviews.
 */
describe('the underline ruling', () => {
  it('registers no underline mark in the schema', () => {
    expect(Object.keys(getSchema(editorExtensions).marks)).not.toContain('underline');
  });

  it('exposes no underline command', () => {
    const editor = new Editor({ extensions: editorExtensions });
    try {
      expect(editor.commands).not.toHaveProperty('toggleUnderline');
    } finally {
      editor.destroy();
    }
  });

  it('binds no Mod-U keyboard shortcut', () => {
    // Read off the extensions' own keymaps rather than simulating a keypress:
    // this is what `@tiptap/extension-underline` contributes, and it is what a
    // reintroduction would bring back.
    // `editorExtensions` holds StarterKit as ONE entry; its children — and
    // `@tiptap/extension-underline` among them — only appear once resolved.
    // Reading the top-level array instead makes this assertion vacuous.
    const bindings = resolveExtensions(editorExtensions).flatMap((extension) => {
      const addKeyboardShortcuts = extension.config.addKeyboardShortcuts;
      if (typeof addKeyboardShortcuts !== 'function') return [];
      // The handlers are never invoked, only their keys inspected, so a stub
      // `this` carrying just the fields Tiptap's own shortcut declarations read
      // is enough. Any extension whose declaration touches more than that is
      // skipped rather than allowed to throw silently.
      try {
        const context = { editor: null, options: extension.options, name: extension.name };
        // `addKeyboardShortcuts`'s declared `this` is a union across node and
        // mark extensions, so no single object satisfies it. The body is only
        // read for its keys, never run against a real editor.
        const declare = addKeyboardShortcuts as unknown as (
          this: unknown,
        ) => Record<string, unknown>;
        return Object.keys(declare.call(context));
      } catch {
        return [];
      }
    });

    expect(bindings.map((key) => key.toLowerCase())).not.toContain('mod-u');
  });

  it('preserves <u> byte-for-byte instead of rewriting it to ++', () => {
    // With the mark registered, `u` was a recognized HTML tag, so the raw-inline
    // fallback stood aside and the parser upgraded it into the underline mark.
    expect(normalizeMarkdown('<u>underlined</u>')).toBe('<u>underlined</u>');
  });

  it('keeps recognized inline HTML upgrading, so the fix is not a blanket opt-out', () => {
    expect(normalizeMarkdown('<em>hi</em>')).toBe('*hi*');
    expect(normalizeMarkdown('<mark>x</mark>')).toBe('==x==');
  });
});

describe('code block highlighting', () => {
  it('registers the lowlight code block, not StarterKit’s plain one', () => {
    // The failure this catches is silent: if StarterKit’s `codeBlock` is left
    // enabled AND CodeBlockLowlight is added, Tiptap’s reversed extension
    // order means one of them wins with no warning, and the losing case is a
    // fully working editor that simply never highlights. Asserting on a
    // rendered colour would not see it either, because jsdom has no cascade.
    const codeBlock = editorExtensions.find((extension) => extension.name === 'codeBlock');
    expect(codeBlock).toBeDefined();
    expect(codeBlock?.options).toHaveProperty('lowlight');
  });

  it('registers exactly one codeBlock in the schema', () => {
    const names = editorExtensions.map((extension) => extension.name);
    expect(names.filter((name) => name === 'codeBlock')).toHaveLength(1);
  });

  it('registers every roster language with lowlight and nothing else', () => {
    expect(lowlight.listLanguages().sort()).toEqual(CODE_LANGUAGES.map((l) => l.id).sort());
  });

  it('leaves the recognized HTML tag set unchanged', () => {
    // `computeRecognizedHtmlTags()` builds a schema from the supported set and
    // decides which inline HTML the raw fallback must rescue. CodeBlockLowlight
    // extends CodeBlock and should parse the same `pre` rule — "should" is not
    // evidence, and a change here silently alters how existing notes round-trip.
    const schema = getSchema(editorExtensions);
    expect(schema.nodes.codeBlock).toBeDefined();
    expect(Object.keys(schema.nodes)).toContain('codeBlock');
  });
});
