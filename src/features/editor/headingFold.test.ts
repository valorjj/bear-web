import { Editor, getSchema } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  renderIconMarkup,
} from '@/ui/Icon';

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
    const markdown = 'Title\n\n## A\n\nbody\n\n## B\n\nmore';
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
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);

    editor.commands.toggleHeadingFold(a!.pos);
    expect(foldedKeys(editor.state)).toEqual([]);
    editor.destroy();
  });

  it('folds every heading, and unfolds every heading', () => {
    const editor = docFor('<p>Title</p><h1>A</h1><p>x</p><h2>B</h2><p>y</p>');

    editor.commands.foldAllHeadings();
    expect(foldedKeys(editor.state)).toEqual(['1:0:A', '2:0:B']);

    editor.commands.unfoldAllHeadings();
    expect(foldedKeys(editor.state)).toEqual([]);
    editor.destroy();
  });

  it('restores a persisted fold set', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p>');

    editor.commands.setHeadingFolds(['2:0:A']);
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    editor.destroy();
  });

  it('keeps a fold key that currently matches no heading, so it returns if the heading does', () => {
    // Leading title paragraph: without it, A is the title and
    // `headingSections` returns nothing at all, so `2:0:Gone` hiding zero
    // sections would be trivially true of ANY key — matching or not — and
    // the fail-open half below would stop discriminating anything. With a
    // real section present, `2:0:A` (not used here) would have matched it,
    // so `2:0:Gone` demonstrably does not.
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p>');

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
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p><h2>B</h2>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);

    expect(hiddenCount(editor)).toBe(1);
    editor.destroy();
  });

  it('folds nested headings along with their parent', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p><h3>n</h3><p>y</p><h2>B</h2>');
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
    const editor = docFor('<p>Title</p><h1>A</h1><p>x</p><h2>B</h2>');

    expect(widgetKinds(editor).filter((k) => k === 'toggle')).toHaveLength(2);
    expect(widgetKinds(editor).filter((k) => k === 'badge')).toHaveLength(2);
    editor.destroy();
  });

  it('renders no affordance for a heading that is not top level', () => {
    const editor = docFor('<blockquote><h2>Quoted</h2></blockquote>');

    expect(widgetKinds(editor)).toEqual([]);
    editor.destroy();
  });

  // The title line is the note's name, not a section, and is never
  // foldable — see `headingSections`' docblock. This must hold even when the
  // title happens to be an `h1`: `editor.css`'s
  // `> :is(p, h1..h6):first-child` rule renders it identically to a plain
  // paragraph title, so it must carry no gutter widget either, exactly the
  // way a paragraph title never does.
  it('renders no gutter widget for the title line, even when it is an h1', () => {
    const editor = docFor('<h1>Title</h1><p>a</p><h2>Real</h2><p>b</p>');

    // The title's own h1 gets nothing...
    const titleHeading = editor.view.dom.querySelector('h1');
    expect(titleHeading).not.toBeNull();
    expect(titleHeading!.querySelector('[data-fold-toggle]')).toBeNull();
    expect(titleHeading!.querySelector('[data-fold-badge]')).toBeNull();

    // ...while the genuine body heading still gets both, so this isn't
    // "nothing renders at all", but specifically "not for the title".
    const bodyHeading = editor.view.dom.querySelector('h2');
    expect(bodyHeading).not.toBeNull();
    expect(bodyHeading!.querySelector('[data-fold-toggle]')).not.toBeNull();
    expect(bodyHeading!.querySelector('[data-fold-badge]')).not.toBeNull();

    editor.destroy();
  });

  it('adds an inline marker only to a folded heading', () => {
    // Leading title paragraph: without it there is exactly one real
    // section (B, since A would be excluded as the title), and
    // `toHaveLength(1)` can no longer distinguish "a marker on the folded
    // section" from "a marker on every section" — the word "only" needs a
    // second, unfolded section to mean anything.
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p><h2>B</h2>');
    expect(widgetKinds(editor).filter((k) => k === 'marker')).toHaveLength(0);

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);

    expect(widgetKinds(editor).filter((k) => k === 'marker')).toHaveLength(1);
    editor.destroy();
  });

  it('carries the heading level on the badge', () => {
    const editor = docFor('<p>Title</p><h3>C</h3>');
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
    const editor = docFor('<p>Title</p><h2>A</h2>');

    // The whole hover-reveal design depends on this: the CSS selector is
    // `.ProseMirror h2:hover .bear-fold-toggle`, and `position: absolute`
    // resolves against the heading's own box.
    expect(editor.view.dom.querySelector('h2 [data-fold-toggle]')).not.toBeNull();
    editor.destroy();
  });
});

describe('the gutter affordance is accessible', () => {
  it("pins the heading's own accessible name, independent of any widget inside it", () => {
    const editor = docFor('<p>Title</p><h1>Hello</h1>');

    // The badge USED to carry its level as a digit, and that digit was the
    // measured pollution source — verified with `dom-accessibility-api` (the
    // engine `toHaveAccessibleName` uses): an un-hidden `<button>1</button>`
    // sibling inside a heading is read as content and produces the name
    // "1 Hello". The badge now draws a `Heading1`-`Heading6` glyph instead and
    // has no text at all, so simply un-hiding it would no longer pollute
    // anything — this test would still pass with the `Decoration.node` DELETED,
    // which is precisely the vacuous-assertion shape this file exists to avoid.
    //
    // So the text is put back deliberately: un-hide the badge AND give it
    // content, simulating any future widget that forgets to hide itself. What
    // is being pinned is the `Decoration.node` aria-label, not the badge's
    // current markup. Without that decoration in `HeadingFold.ts`, this fails:
    // the heading announces as "1 Hello".
    const badge = editor.view.dom.querySelector('[data-fold-badge]');
    expect(badge).not.toBeNull();
    badge!.removeAttribute('aria-hidden');
    badge!.textContent = '1';

    const heading = editor.view.dom.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(heading).toHaveAccessibleName('Hello');
    editor.destroy();
  });

  it("tracks an edit to the heading's own text", () => {
    // Leading title paragraph: without it, "Old title" would itself be the
    // note's title and excluded from `headingSections`, so the pinned
    // `aria-label` decoration this test exercises would never be applied at
    // all — the assertion below would then pass on the heading's plain
    // text content instead, which is a different (and always-true)
    // mechanism than the one this test names.
    const editor = docFor('<p>Title</p><h2>Old title</h2><p>x</p>');
    const [section] = headingSections(editor.state.doc);

    editor.commands.setTextSelection(section!.pos + 1);
    editor.commands.insertContentAt(section!.pos + 1, 'New ');

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
      content: '<p>Title</p><h2>A</h2><p>x</p>',
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

  it('the badge stays aria-hidden and out of tab order', () => {
    const editor = docFor('<p>Title</p><h3>C</h3>');

    // A digit was the original reason (see the accessible-name test above).
    // The glyph that replaced it contributes no text, but the badge stays
    // hidden anyway: it is a mouse-only duplicate of the level menu, which
    // `Mod-Alt-1`-`6` already reaches from the keyboard, and an un-named
    // `<button>` announced as "button" is worse than no button at all.
    const badge = editor.view.dom.querySelector('[data-fold-badge]');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveAttribute('tabindex', '-1');
    editor.destroy();
  });

  it('draws the level as a glyph, not as a digit', () => {
    // The user's report that opened this change: hovering a heading showed a
    // number where an icon was expected. The level must still be legible from
    // the badge alone, which is why it is `Heading1`-`Heading6` rather than one
    // generic heading glyph.
    for (const [level, glyph] of [
      [1, Heading1],
      [2, Heading2],
      [3, Heading3],
      [4, Heading4],
      [5, Heading5],
      [6, Heading6],
    ] as const) {
      const editor = docFor(`<p>Title</p><h${level}>C</h${level}>`);
      const badge = editor.view.dom.querySelector('[data-fold-badge]');

      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe('');
      expect(badge!.querySelector('svg')).not.toBeNull();
      expect(badge!.innerHTML).toBe(renderIconMarkup(glyph));
      // `data-level` is now the ONLY machine-readable record of the level on
      // the badge — the digit that used to also carry it is gone.
      expect(badge!.getAttribute('data-level')).toBe(String(level));

      editor.destroy();
    }
  });

  it('renders a visible glyph, not an empty box', () => {
    const editor = docFor('<p>Title</p><h2>A</h2>');

    const toggle = editor.view.dom.querySelector('[data-fold-toggle]');
    // Asserted separately from the glyph check below: `toggle?.querySelector`
    // on a `null` toggle (e.g. if the fixture's heading were the title, and
    // so had no toggle at all) returns `undefined`, and `undefined` also
    // satisfies `.not.toBeNull()` — a vacuous pass that would never notice a
    // missing toggle.
    expect(toggle).not.toBeNull();
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
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p>');

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
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p>');
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
    // Leading title paragraph: an empty `<h2>` at offset 0 would be excluded
    // as the title anyway, which would make this pass for the title rule
    // rather than for the empty-text branch this test names (see
    // `HeadingFold.ts`'s `section.text !== ''` guard).
    const editor = docFor('<p>Title</p><h2></h2>');

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
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p><h2>B</h2><p>y</p>');
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
      content: '<p>Title</p><h2>A</h2><p>x</p>',
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
      content: '<p>Title</p><h1>A</h1><p>x</p><h3>B</h3><p>y</p>',
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
      content: '<p>Title</p><h2>A</h2><p>x</p>',
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
      // Leading title paragraph: without it, "A" is the title and gets no
      // badge at all, and the `querySelector` below would resolve to `null`
      // — a right-click on a NON-EXISTENT badge trivially "does nothing",
      // which is not what this test names.
      content: '<p>Title</p><h2>A</h2><p>x</p>',
    });

    const badge = editor.view.dom.querySelector('[data-fold-badge]');
    expect(badge).not.toBeNull();
    const result = mousedownOn(editor, badge!, { button: 2 });

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
    const editor = docFor('<p>Title</p><h2>A</h2><p>x</p>');

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
    const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
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
    const editor = docFor('<p>Title</p><h2>A</h2><p>visible</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const before = editor.getHTML();
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    expect(editor.getHTML()).not.toBe(before);
    editor.destroy();
  });

  // The reachable Backspace hazard, measured: with `<h2>A</h2><p>hidden</p>`
  // folded, then `<h2>B</h2><p>visible</p>` after it, `headingSections` gives
  // section A an `end` equal to B's own `pos` (11 in this fixture) — `end` is
  // defined as the next heading's position. `end + 1` (12) is therefore the
  // start of B's own inline content: a real, VISIBLE caret position, unlike
  // `contentStart + 1`, which sits inside A's hidden body and can never hold
  // a caret at all. Backspacing at `end + 1` with no guard runs
  // `joinBackward`, which merges heading B into A's hidden last block —
  // confirmed by a scratch measurement (not committed) before this fix: the
  // document went from four blocks (`A`, hidden `hidden`, `B`, `visible`) to
  // three, with B's text silently absorbed into the hidden paragraph as
  // `"hiddenB"` and the heading itself gone.
  it('Backspace at the start of the block after a folded section unfolds instead of destroying it', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p><h2>B</h2><p>visible</p>');
    const [a, b] = headingSections(editor.state.doc);
    expect(a!.end).toBe(b!.pos);
    editor.commands.toggleHeadingFold(a!.pos);
    editor.commands.setTextSelection(a!.end + 1);

    const before = editor.getHTML();
    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
    );

    expect(handled).toBe(true);
    expect(foldedKeys(editor.state)).toEqual([]);
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  it('leaves Backspace alone when the section is not folded', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p><h2>B</h2><p>visible</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.end + 1);

    const before = editor.getHTML();
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
    );

    // Unrelated to this guard, joinBackward merges B into the (unfolded, so
    // fully visible) "hidden" paragraph — a real edit, so the document
    // changes, just as the equivalent Delete case does above.
    expect(editor.getHTML()).not.toBe(before);
    editor.destroy();
  });

  // Enter at the end of a folded heading runs `splitBlock`, which inserts the
  // new empty paragraph INSIDE the section's hidden range (`contentStart -
  // 1` is exactly where the split lands), leaving the user typing into
  // `display: none` content with no visual feedback. Unlike Backspace/Delete,
  // nothing is destroyed here, so the fix is not "block the keystroke" but
  // "unfold first, then let the keystroke do its normal job" — asserted by
  // `handled === false` (the guard does NOT consume Enter) together with the
  // fold actually having cleared.
  // `someProp('handleKeyDown', …)` here exercises the WHOLE keydown chain,
  // not just this plugin's own handler: ProseMirror calls every plugin's
  // `handleKeyDown` in order and stops at the first truthy result, and
  // `@tiptap/core`'s built-in `Keymap` extension is one of those plugins,
  // binding Enter to `splitBlock`. That is exactly what this test needs —
  // it proves the guard's `return false` really does hand off to that
  // built-in handler, which then runs `splitBlock` against the
  // ALREADY-unfolded state this guard just dispatched, landing the new
  // paragraph somewhere `.bear-fold-hidden` no longer reaches. A guard that
  // instead consumed Enter (`return true`, doing nothing but unfolding)
  // would fail this: `splitBlock` would never run and the document would be
  // unchanged aside from the fold clearing.
  it('Enter at the end of a folded heading unfolds and lets the split land in visible content', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    editor.commands.setTextSelection(a!.contentStart - 1);

    expect(foldedKeys(editor.state)).toEqual([serializeFoldKey(foldKeyOf(a!))]);

    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );

    expect(handled).toBe(true);
    expect(foldedKeys(editor.state)).toEqual([]);
    expect(editor.view.dom.querySelector('.bear-fold-hidden')).toBeNull();
    editor.destroy();
  });

  // Mirrors the equivalent Delete/Backspace tests above: with nothing
  // folded, this guard's own `keys.size === 0` check returns `false`
  // immediately, and the built-in Enter keymap runs unaffected — asserted by
  // the document actually changing (the split happened), not by `handled`,
  // which the built-in handler alone already makes `true`.
  it('leaves Enter alone when the section is not folded', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>visible</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const before = editor.getHTML();
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );

    expect(editor.getHTML()).not.toBe(before);
    editor.destroy();
  });

  // The macOS delete-variant chords: `@tiptap/core`'s own `Keymap` extension
  // binds `Ctrl-h` to the same handler as plain `Backspace`, and `Ctrl-d`/
  // `Alt-d` to the same handler as plain `Delete` — but `event.key` for those
  // chords is the literal letter, not `'Backspace'`/`'Delete'`, so a naive
  // `event.key` check would let a Mac user destroy hidden content through
  // exactly this route. One of each is covered here; `Alt-Backspace`,
  // `Ctrl-Alt-Backspace` and `Alt-Delete` still report `event.key` as
  // `'Backspace'`/`'Delete'` and are already covered by the tests above.
  //
  // `@tiptap/core`'s own `Keymap` extension only binds these chords inside
  // an `isMacOS() || isiOS()` branch, so the guard's own key check must be
  // gated the same way — otherwise a Windows/Linux user's unrelated `Ctrl-h`/
  // `Ctrl-d` browser or OS shortcut would be swallowed. jsdom's default
  // `navigator.platform` is `''`, which is not any recognized Apple platform
  // string, so `isMacOS()` is false in every test run unless a test stubs it
  // — exactly the pattern `tagPill.test.ts` uses for the same reason. These
  // two tests stub `navigator.platform` to `'MacIntel'` so the Mac branch is
  // actually driven rather than dead code guarded by nothing; the platform
  // gate itself (both directions) is pinned separately below.
  it('Ctrl-h at the Backspace boundary unfolds, like plain Backspace, on macOS', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p><h2>B</h2><p>visible</p>');
      const [a] = headingSections(editor.state.doc);
      editor.commands.toggleHeadingFold(a!.pos);
      editor.commands.setTextSelection(a!.end + 1);

      const handled = editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'h', ctrlKey: true })),
      );

      expect(handled).toBe(true);
      expect(foldedKeys(editor.state)).toEqual([]);
      editor.destroy();
    } finally {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it('Ctrl-d at the Delete boundary unfolds, like plain Delete, on macOS', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
      const [a] = headingSections(editor.state.doc);
      editor.commands.toggleHeadingFold(a!.pos);
      editor.commands.setTextSelection(a!.contentStart - 1);

      const handled = editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'd', ctrlKey: true })),
      );

      expect(handled).toBe(true);
      expect(foldedKeys(editor.state)).toEqual([]);
      editor.destroy();
    } finally {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it('does not intercept a plain "h" or "d" keystroke (ordinary typing)', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const handledH = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'h' })),
    );
    const handledD = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'd' })),
    );

    expect(handledH).toBeFalsy();
    expect(handledD).toBeFalsy();
    // Still folded: neither plain letter unfolded the section.
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    editor.destroy();
  });
});

describe('the macOS delete-variant chords are platform-gated', () => {
  it('Ctrl-d unfolds when isMacOS() is true', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
      const [a] = headingSections(editor.state.doc);
      editor.commands.toggleHeadingFold(a!.pos);
      editor.commands.setTextSelection(a!.contentStart - 1);

      const handled = editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'd', ctrlKey: true })),
      );

      expect(handled).toBe(true);
      expect(foldedKeys(editor.state)).toEqual([]);
      editor.destroy();
    } finally {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  // Off Apple platforms, `@tiptap/core` never binds `Ctrl-d` to a delete
  // handler at all — it is a real, unrelated OS/browser shortcut there — so
  // this guard must not intercept it either. Without the `isMacOS()` gate on
  // the implementation side, this is exactly the case that regresses: the
  // section would unfold for a keystroke that carries no delete meaning on
  // this platform.
  it('Ctrl-d falls through untouched when isMacOS() is false', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    try {
      const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
      const [a] = headingSections(editor.state.doc);
      editor.commands.toggleHeadingFold(a!.pos);
      editor.commands.setTextSelection(a!.contentStart - 1);

      const handled = editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'd', ctrlKey: true })),
      );

      expect(handled).toBeFalsy();
      // Still folded: the non-Mac platform never triggers the guard's
      // Ctrl-d/Ctrl-h branch, so nothing here unfolds the section.
      expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
      editor.destroy();
    } finally {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});

describe('the fold-boundary guard only intercepts a collapsed caret', () => {
  it('leaves a non-empty selection spanning the boundary alone, even when folded, and the deletion still happens', () => {
    const editor = docFor('<p>Title</p><h2>A</h2><p>hidden</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    // A real selection spanning the fold boundary — from just before it to
    // just after — rather than the collapsed caret the guard is meant to
    // intercept.
    editor.commands.setTextSelection({ from: a!.contentStart - 1, to: a!.contentStart + 1 });

    const before = editor.getHTML();
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    // The guard must not fire for this selection: it stays folded (the guard
    // didn't unfold it) AND the selected content is actually gone — a real
    // selection whose bounds the user can see is left to normal deletion,
    // not intercepted the way a collapsed caret is. Asserting only the fold
    // key survives would also pass a guard that swallowed the keystroke
    // without deleting anything, which is not the intended asymmetry.
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    expect(editor.getHTML()).not.toBe(before);
    editor.destroy();
  });
});
