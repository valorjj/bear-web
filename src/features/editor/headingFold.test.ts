import { Editor, getSchema } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { HeadingFold, foldedKeys } from './HeadingFold';
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

/**
 * Widget decorations the plugin currently renders, by their marker attribute.
 *
 * Aggregates every plugin's `decorations` prop and concatenates the results,
 * the way ProseMirror's own `viewDecorations` does — not
 * `editor.view.someProp('decorations', (f) => f(editor.state))`'s
 * short-circuit-on-first-truthy-result form. See `hiddenCount` above for why
 * that form is a trap: it would report zero widgets for the wrong reason if
 * this file ever gained another plugin ahead of `headingFold$` in
 * `state.plugins`, and the assertions below would pass vacuously.
 */
function widgetKinds(editor: Editor): string[] {
  const kinds: string[] = [];
  for (const plugin of editor.state.plugins) {
    const prop = plugin.props.decorations;
    if (!prop) continue;
    const result = prop.call(plugin, editor.state) as DecorationSet | null | undefined;
    for (const d of result?.find() ?? []) {
      const kind = (d.spec as { foldWidget?: string }).foldWidget;
      if (kind) kinds.push(kind);
    }
  }
  return kinds;
}

describe('the gutter affordance', () => {
  it('renders a toggle and a badge for every top-level heading', () => {
    const editor = docFor('<h1>A</h1><p>x</p><h2>B</h2>');

    expect(widgetKinds(editor).filter((k) => k === 'toggle')).toHaveLength(2);
    expect(widgetKinds(editor).filter((k) => k === 'badge')).toHaveLength(2);
    editor.destroy();
  });

  it('renders no affordance for a heading that is not top level', () => {
    const editor = docFor('<blockquote><h2>Quoted</h2></blockquote>');

    expect(widgetKinds(editor)).toEqual([]);
    editor.destroy();
  });

  it('adds an inline marker only to a folded heading', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2>');
    expect(widgetKinds(editor).filter((k) => k === 'marker')).toHaveLength(0);

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);

    expect(widgetKinds(editor).filter((k) => k === 'marker')).toHaveLength(1);
    editor.destroy();
  });

  it('carries the heading level on the badge', () => {
    const editor = docFor('<h3>C</h3>');
    const levels: number[] = [];
    for (const plugin of editor.state.plugins) {
      const prop = plugin.props.decorations;
      if (!prop) continue;
      const result = prop.call(plugin, editor.state) as DecorationSet | null | undefined;
      for (const d of result?.find() ?? []) {
        const spec = d.spec as { foldWidget?: string; level?: number };
        if (spec.foldWidget === 'badge' && spec.level !== undefined) levels.push(spec.level);
      }
    }

    // Asserted through the decoration SPEC, not through ProseMirror's widget
    // internals: `Decoration.widget(pos, fn)` stores the builder function, so
    // reading `.type.toDOM.textContent` returns undefined and the assertion
    // could never pass.
    expect(levels).toEqual([3]);
    editor.destroy();
  });

  it('places the affordance inside the heading element, not beside it', () => {
    const editor = docFor('<h2>A</h2>');

    // The whole hover-reveal design depends on this: the CSS selector is
    // `.ProseMirror h2:hover .bear-fold-toggle`, and `position: absolute`
    // resolves against the heading's own box.
    expect(editor.view.dom.querySelector('h2 [data-fold-toggle]')).not.toBeNull();
    editor.destroy();
  });
});

describe('the gutter affordance is accessible', () => {
  it("pins the heading's own accessible name, independent of any widget inside it", () => {
    const editor = docFor('<h1>Hello</h1>');

    // The badge's own `textContent` (its level digit) is the measured
    // pollution source — verified with `dom-accessibility-api` (the engine
    // `toHaveAccessibleName` uses): an un-hidden `<button>1</button>` sibling
    // inside a heading is read as content and produces the name "1 Hello".
    // The badge stays `aria-hidden` precisely because of this, but the
    // `Decoration.node` aria-label is what makes the heading's name correct
    // EVEN IF some future widget forgets to hide itself — simulated here by
    // stripping the badge's own `aria-hidden` after render and asserting the
    // heading's name is unaffected. Without the `Decoration.node` in
    // `HeadingFold.ts`, this fails: the heading announces as "1 Hello".
    const badge = editor.view.dom.querySelector('[data-fold-badge]');
    expect(badge).not.toBeNull();
    badge!.removeAttribute('aria-hidden');

    const heading = editor.view.dom.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(heading).toHaveAccessibleName('Hello');
    editor.destroy();
  });

  it("tracks an edit to the heading's own text", () => {
    const editor = docFor('<h2>Old title</h2><p>x</p>');

    editor.commands.setTextSelection(1);
    editor.commands.insertContentAt(1, 'New ');

    const heading = editor.view.dom.querySelector('h2');
    expect(heading).toHaveAccessibleName('New Old title');
    editor.destroy();
  });

  it('is not aria-hidden, and carries aria-label and aria-expanded', () => {
    // A standalone editor so `foldHint` is a real, non-null value — the
    // shipped app's `editorExtensions` registers `HeadingFold` with no
    // options, so `docFor` alone could never exercise a non-null hint.
    const editor = new Editor({
      extensions: [StarterKit, HeadingFold.configure({ foldHint: 'Fold or unfold this section' })],
      content: '<h2>A</h2><p>x</p>',
    });

    const toggle = editor.view.dom.querySelector('[data-fold-toggle]');
    expect(toggle).not.toBeNull();
    expect(toggle).not.toHaveAttribute('aria-hidden');
    expect(toggle).toHaveAttribute('aria-label', 'Fold or unfold this section');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    expect(editor.view.dom.querySelector('[data-fold-toggle]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    editor.destroy();
  });

  it('the badge stays aria-hidden and out of tab order, since its digit is what polluted the name', () => {
    const editor = docFor('<h3>C</h3>');

    const badge = editor.view.dom.querySelector('[data-fold-badge]');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveAttribute('tabindex', '-1');
    editor.destroy();
  });

  it('renders a visible glyph, not an empty box', () => {
    const editor = docFor('<h2>A</h2>');

    const toggle = editor.view.dom.querySelector('[data-fold-toggle]');
    // jsdom has no layout engine, so a rendered pixel size cannot be asserted
    // here (see CLAUDE.md's toolchain notes) — a glyph child is the
    // structural proxy for "this control has visible content", and is
    // exactly what `e2e/appearance.spec.ts` would additionally confirm has
    // non-zero `getBoundingClientRect()` in a real browser.
    expect(toggle?.querySelector('svg')).not.toBeNull();
    editor.destroy();
  });
});
