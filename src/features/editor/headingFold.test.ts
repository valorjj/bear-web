import { Editor, getSchema } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { foldedKeys } from './HeadingFold';
import { headingSections } from './headingSections';
import { parseMarkdown, serializeMarkdown } from './markdown';

function docFor(html: string): Editor {
  return new Editor({ extensions: editorExtensions, content: html });
}

describe('the heading fold schema contract', () => {
  it('adds nothing to the schema, because it is an Extension', () => {
    const schema = getSchema(editorExtensions);

    expect(Object.keys(schema.nodes)).not.toContain('headingFold');
    expect(Object.keys(schema.marks)).not.toContain('headingFold');
  });

  it('leaves the document byte-identical when a section is folded', () => {
    const markdown = '## A\n\nbody\n\n## B\n\nmore';
    const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
    const before = serializeMarkdown(editor.getJSON());

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
    editor.destroy();
  });
});

describe('folding commands', () => {
  it('toggles one heading on and off', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);

    editor.commands.toggleHeadingFold(a!.pos);
    expect(foldedKeys(editor.state)).toEqual([]);
    editor.destroy();
  });

  it('folds every heading, and unfolds every heading', () => {
    const editor = docFor('<h1>A</h1><p>x</p><h2>B</h2><p>y</p>');

    editor.commands.foldAllHeadings();
    expect(foldedKeys(editor.state)).toEqual(['1:0:A', '2:0:B']);

    editor.commands.unfoldAllHeadings();
    expect(foldedKeys(editor.state)).toEqual([]);
    editor.destroy();
  });

  it('restores a persisted fold set', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');

    editor.commands.setHeadingFolds(['2:0:A']);
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    editor.destroy();
  });

  it('keeps a fold key that currently matches no heading, so it returns if the heading does', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');

    editor.commands.setHeadingFolds(['2:0:Gone']);
    // Retained in state...
    expect(foldedKeys(editor.state)).toEqual(['2:0:Gone']);
    // ...but hides nothing, which is the fail-open half.
    expect(hiddenCount(editor)).toBe(0);
    editor.destroy();
  });
});

/**
 * How many blocks the plugin is currently hiding.
 *
 * Gathers every plugin's `decorations` prop and concatenates the results,
 * the way ProseMirror's own `viewDecorations` does, rather than
 * `editor.view.someProp('decorations', (f) => f(editor.state))`'s
 * short-circuit-on-first-truthy-result form. That form happens to work
 * today only because extension order is reversed when `state.plugins` is
 * built (see `tagPill.test.ts` and `RichEditor.test.tsx`, which hit the
 * same thing), which puts `headingFold$` first — but Task 4 adds more
 * plugin props to this same file, and that ordering is not something to
 * depend on. The stakes here are asymmetric: `toBe(1)`/`toBe(3)` below
 * would fail loudly if this read the wrong plugin's decorations, but the
 * fail-open assertion — `hiddenCount(editor)` toBe(0) for a fold key that
 * matches no heading — would PASS VACUOUSLY if `HeadingFold` were shadowed,
 * dead, or merely reading some other plugin's empty set instead of its own.
 */
function hiddenCount(editor: Editor): number {
  return editor.state.plugins
    .flatMap((plugin) => {
      const prop = plugin.props.decorations;
      if (!prop) return [];
      // `decorations`'s declared `this` is the owning `Plugin`, and its
      // declared return type is the general `DecorationSource`, which has
      // no `.find()` — only the concrete `DecorationSet` every plugin in
      // this app actually returns does.
      const result = prop.call(plugin, editor.state) as DecorationSet | null | undefined;
      return result?.find() ?? [];
    })
    .filter((d) => (d.spec as { foldHidden?: boolean }).foldHidden).length;
}

describe('fold decorations', () => {
  it('hides the section body and not its heading', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);

    expect(hiddenCount(editor)).toBe(1);
    editor.destroy();
  });

  it('folds nested headings along with their parent', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h3>n</h3><p>y</p><h2>B</h2>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);

    // paragraph, h3, paragraph
    expect(hiddenCount(editor)).toBe(3);
    editor.destroy();
  });
});
