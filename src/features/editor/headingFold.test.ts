import { Editor, getSchema } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { HeadingFold, foldedKeys, type HeadingMenuRequest } from './HeadingFold';
import { foldKeyOf, headingSections, serializeFoldKey } from './headingSections';
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

describe('widget DOM reuse across re-renders', () => {
  it('keeps the same toggle DOM node across an unrelated (selection-only) transaction', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');

    const before = editor.view.dom.querySelector('[data-fold-toggle]');
    expect(before).not.toBeNull();

    // A selection-only change still runs `decorations(state)` again, but
    // `folded` hasn't changed, so the widget's `key` should let ProseMirror
    // reuse the existing DOM node rather than destroy and rebuild it.
    editor.commands.setTextSelection(1);

    const after = editor.view.dom.querySelector('[data-fold-toggle]');
    expect(after).toBe(before);
    editor.destroy();
  });

  it('rebuilds the toggle only when its own folded state actually changes', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');
    const [a] = headingSections(editor.state.doc);

    const before = editor.view.dom.querySelector('[data-fold-toggle]');
    expect(before).toHaveAttribute('aria-expanded', 'true');

    editor.commands.toggleHeadingFold(a!.pos);
    const after = editor.view.dom.querySelector('[data-fold-toggle]');

    // Different `folded` state means a different `key`, so a genuine change
    // is still expected to produce a new element with the updated
    // `aria-expanded` — reuse must not mean "never updates".
    expect(after).not.toBeNull();
    expect(after).toHaveAttribute('aria-expanded', 'false');
    // Not asserting `after !== before` by identity: ProseMirror MAY recycle
    // the DOM node itself and merely re-run the builder, or may swap it for
    // a fresh element — either is correct. What matters is the rendered
    // attribute reflects the new state, checked above.
    editor.destroy();
  });
});

describe('an empty heading', () => {
  it('gets no aria-label decoration', () => {
    const editor = docFor('<h2></h2>');

    const heading = editor.view.dom.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading).not.toHaveAttribute('aria-label');
    editor.destroy();
  });
});

/**
 * Dispatches the real `Mod-Alt-f` key combination through the editor's own
 * `handleKeyDown` chain, the way `addKeyboardShortcuts` bindings are actually
 * reached — never a made-up `editor.commands.*` shortcut-invoker, which does
 * not exist on `Editor`. Under jsdom, `navigator.platform` is `''`
 * (see CLAUDE.md's `isMacOS()` note), so `prosemirror-keymap`'s own
 * mac-detection is also false there and normalizes `Mod` to `Ctrl`, not `Meta`
 * — hence `ctrlKey`, not `metaKey`, below.
 *
 * `Mod-Alt-f`, not `Mod-Alt-0`: the binding was moved after a review found
 * `Mod-Alt-0` collides with `@tiptap/extension-paragraph`'s own
 * `setParagraph()` binding, with `HeadingFold` winning the collision because
 * Tiptap builds its plugins from a reversed extension array. See the long
 * comment on `addKeyboardShortcuts` in `HeadingFold.ts` for the verification
 * command run against `node_modules/@tiptap`.
 *
 * Uses `someProp`'s short-circuit-on-first-truthy form DELIBERATELY, unlike
 * the `decorations` prop elsewhere in this file: `handleKeyDown` is a
 * "first plugin to claim it wins" prop in real ProseMirror dispatch (each
 * keymap plugin's handler runs in order until one returns true), so this is
 * the correct simulation, not the aggregation trap `widgetKinds`/`hiddenCount`
 * exist to avoid for `decorations`.
 */
function pressModAltF(editor: Editor): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) === true;
}

describe('Mod-Alt-f folds the section under the cursor', () => {
  it('toggles the fold of the enclosing top-level section', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2><p>y</p>');
    const [a] = headingSections(editor.state.doc);

    // Cursor inside the FIRST section's body paragraph, not on the heading
    // line itself — proving this resolves "enclosing section", not merely
    // "the heading the caret sits on".
    editor.commands.setTextSelection(a!.contentStart + 1);

    const handled = pressModAltF(editor);
    expect(handled).toBe(true);
    expect(foldedKeys(editor.state)).toEqual([serializeFoldKey(foldKeyOf(a!))]);

    editor.destroy();
  });

  it('returns false, letting the key fall through, when the cursor is outside any section', () => {
    const editor = docFor('<p>before any heading</p><h2>A</h2><p>x</p>');

    editor.commands.setTextSelection(1);

    const handled = pressModAltF(editor);
    expect(handled).toBe(false);
    expect(foldedKeys(editor.state)).toEqual([]);

    editor.destroy();
  });
});

/**
 * Invokes the plugin's own `handleDOMEvents.mousedown` against the REAL,
 * mounted `EditorView` — not a fake `posAtCoords` stand-in like `TagPill`'s
 * `mousedownAt` needs, because this handler resolves through `posAtDOM`
 * against an actual DOM element rather than viewport coordinates, and
 * `posAtDOM` needs no layout engine to work in jsdom (only `posAtCoords`
 * does). `target` is set with `Object.defineProperty` because a
 * manually-constructed `MouseEvent` has a `null` target until the browser
 * dispatches it, and the handler is invoked directly here rather than
 * through a real DOM dispatch.
 */
function mousedownOn(
  editor: Editor,
  element: Element,
  init: MouseEventInit = {},
): { handled: boolean; defaultPrevented: boolean } {
  const event = new MouseEvent('mousedown', {
    cancelable: true,
    bubbles: true,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: element, configurable: true });
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.mousedown === undefined ? false : handlers.mousedown(editor.view, event as never),
    ) === true;
  return { handled, defaultPrevented: event.defaultPrevented };
}

describe('the mousedown handler on the badge and toggle', () => {
  it('toggles the fold when the toggle is clicked, and does not open the menu', () => {
    const opened: HeadingMenuRequest[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onOpenMenu: (request) => opened.push(request) }),
      content: '<h2>A</h2><p>x</p>',
    });

    const toggle = editor.view.dom.querySelector('[data-fold-toggle]')!;
    const result = mousedownOn(editor, toggle);

    expect(result.handled).toBe(true);
    expect(result.defaultPrevented).toBe(true);
    const [a] = headingSections(editor.state.doc);
    expect(foldedKeys(editor.state)).toEqual([serializeFoldKey(foldKeyOf(a!))]);
    expect(opened).toEqual([]);

    editor.destroy();
  });

  // The widgets are rendered as CHILDREN of the heading (`section.pos + 1`,
  // not `section.pos`), so a click's `posAtDOM` resolution lands strictly
  // INSIDE the heading, never on its own boundary. A doc with two headings is
  // the case that actually exercises the arithmetic: resolving to the wrong
  // section (e.g. always finding the first) would be invisible with only one
  // heading in the fixture.
  it('resolves a badge click on the SECOND heading to its own section, not the first', () => {
    const opened: HeadingMenuRequest[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onOpenMenu: (request) => opened.push(request) }),
      content: '<h1>A</h1><p>x</p><h3>B</h3><p>y</p>',
    });

    const [a, b] = headingSections(editor.state.doc);
    const badges = editor.view.dom.querySelectorAll('[data-fold-badge]');
    expect(badges).toHaveLength(2);

    const result = mousedownOn(editor, badges[1]!);

    expect(result.handled).toBe(true);
    expect(result.defaultPrevented).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ pos: b!.pos, level: b!.level, folded: false });
    // Not the first heading's position, and not folded as a side effect.
    expect(opened[0]!.pos).not.toBe(a!.pos);
    expect(foldedKeys(editor.state)).toEqual([]);

    editor.destroy();
  });

  it('reports the current fold state to the menu request', () => {
    const opened: HeadingMenuRequest[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onOpenMenu: (request) => opened.push(request) }),
      content: '<h2>A</h2><p>x</p>',
    });

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);

    const badge = editor.view.dom.querySelector('[data-fold-badge]')!;
    mousedownOn(editor, badge);

    expect(opened).toHaveLength(1);
    expect(opened[0]!.folded).toBe(true);

    editor.destroy();
  });

  it('does nothing on a right-click', () => {
    const opened: HeadingMenuRequest[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onOpenMenu: (request) => opened.push(request) }),
      content: '<h2>A</h2><p>x</p>',
    });

    const badge = editor.view.dom.querySelector('[data-fold-badge]')!;
    const result = mousedownOn(editor, badge, { button: 2 });

    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);
    expect(opened).toEqual([]);

    editor.destroy();
  });

  // `editorExtensions` (the shipped, schema-only constant) registers
  // `HeadingFold` with no options, so `onOpenMenu` is `null` — the same
  // "nobody is listening" state `TagPill.onActivate` uses. A badge click must
  // not throw, and must leave the caret placement to the browser rather than
  // swallowing the click for a menu that will never open.
  it('does nothing when nobody is listening for the menu', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');

    const badge = editor.view.dom.querySelector('[data-fold-badge]')!;
    const result = mousedownOn(editor, badge);

    // `handled` is false — ProseMirror's own mousedown handling is otherwise
    // free to run. `defaultPrevented` is still true, because `preventDefault`
    // runs unconditionally once a section is resolved (see the handler's own
    // comment): what must never happen is the caret jumping to the widget's
    // position, regardless of whether a menu was actually opened.
    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(true);
    expect(foldedKeys(editor.state)).toEqual([]);

    editor.destroy();
  });
});

describe('editing at a fold boundary', () => {
  it('Delete at the end of a folded heading unfolds instead of deleting hidden content', () => {
    const editor = docFor('<h2>A</h2><p>hidden</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const before = editor.getHTML();
    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    expect(handled).toBe(true);
    expect(foldedKeys(editor.state)).toEqual([]);
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  // `handled` itself cannot be the assertion here: with nothing folded, the
  // guard's own `handleKeyDown` returns `false` and the keystroke falls
  // through to ProseMirror's own default keymap, whose "Delete" binding joins
  // the following paragraph into the heading — a real, correct edit that
  // returns `true` on its own, unrelated to this plugin. So this asserts the
  // thing the guard is actually responsible for: that the edit was NOT
  // blocked, by checking the document actually changed (the merge happened)
  // rather than staying byte-identical the way the folded case above does.
  it('leaves Delete alone when the section is not folded', () => {
    const editor = docFor('<h2>A</h2><p>visible</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const before = editor.getHTML();
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    expect(editor.getHTML()).not.toBe(before);
    editor.destroy();
  });
});

describe('the fold-boundary guard only intercepts a collapsed caret', () => {
  it('leaves a non-empty selection spanning the boundary alone, even when folded', () => {
    const editor = docFor('<h2>A</h2><p>hidden</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    // A real selection spanning the fold boundary — from just before it to
    // just after — rather than the collapsed caret the guard is meant to
    // intercept.
    editor.commands.setTextSelection({ from: a!.contentStart - 1, to: a!.contentStart + 1 });

    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    // The guard must not fire for this selection: it stays folded (the guard
    // didn't unfold it), because a real selection whose bounds the user can
    // see is left to normal deletion, not intercepted the way a collapsed
    // caret is.
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    void handled;
    editor.destroy();
  });
});
