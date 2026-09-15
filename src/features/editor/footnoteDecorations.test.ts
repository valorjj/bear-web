import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';

/*
 * jsdom has no layout engine, so ProseMirror's `posAtCoords` throws on APIs it
 * never implements. Needed here because the fail-open test DECLINES a click:
 * the event then falls through to ProseMirror's own mousedown handler, exactly
 * as it does for a real reader, and that handler resolves coordinates.
 *
 * Without these the suite reports 3141 passing tests and exits 1 — the
 * uncaught-error trap CLAUDE.md records. Same three stubs as
 * `linkPill.test.ts`'s header.
 */
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
};
Range.prototype.getBoundingClientRect = () => emptyRect;
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

const createdEditors: Editor[] = [];

const WITH_SECTION = buildEditorExtensions({
  footnoteSectionLabel: '각주',
  footnoteBackLabel: 'Back to the reference',
});

function mounted(
  markdown: string,
  extensions = editorExtensions,
): { editor: Editor; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    extensions,
    content: parseMarkdown(markdown),
    element: el,
  });
  createdEditors.push(editor);
  return { editor, el };
}

afterEach(() => {
  while (createdEditors.length > 0) {
    createdEditors.pop()!.destroy();
  }
});

const numbers = (el: HTMLElement) =>
  [...el.querySelectorAll('.bear-footnote-number')].map((n) => n.textContent);

describe('footnote numbers in the editor', () => {
  it('numbers markers by order of first reference', () => {
    const { el } = mounted('Alpha[^why] and beta[^when].\n\n[^when]: b\n\n[^why]: a');

    expect(numbers(el)).toEqual(['1', '2']);
  });

  it('numbers the definitions to match', () => {
    const { el } = mounted('Alpha[^why].\n\n[^why]: a');

    expect([...el.querySelectorAll('.bear-footnote-def-marker')].map((n) => n.textContent)).toEqual(
      ['1. '],
    );
  });

  it('renumbers after an insertion, with no edit to the labels', () => {
    const { editor, el } = mounted('A[^one] C[^three].\n\n[^one]: a\n\n[^three]: c');
    expect(numbers(el)).toEqual(['1', '2']);

    // Insert a reference between them. `three` must become 3 without its
    // label changing — the whole point of positional numbering.
    editor.commands.insertContentAt(8, { type: 'footnoteRef', attrs: { label: 'two' } });

    expect(numbers(el)).toEqual(['1', '2', '3']);
    expect(serializeMarkdown(editor.getJSON())).toContain('[^three]');
  });

  it('leaves an unreferenced definition its label', () => {
    const { el } = mounted('[^orphan]: nobody points here');

    expect([...el.querySelectorAll('.bear-footnote-def-marker')].map((n) => n.textContent)).toEqual(
      ['orphan. '],
    );
  });

  it('puts no number into the document', () => {
    // The whole reason these are decorations. A number in the document would
    // reach the user's markdown and go stale on the next insertion.
    const { editor } = mounted('Alpha[^why].\n\n[^why]: a');

    expect(serializeMarkdown(editor.getJSON())).toBe('Alpha[^why].\n\n[^why]: a');
  });
});

describe('the 각주 section', () => {
  const toggle = (el: HTMLElement) =>
    el
      .querySelector<HTMLElement>('[data-footnote-section-toggle]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));

  it('draws one header above the first definition', () => {
    const { el } = mounted('A[^a] B[^b].\n\n[^a]: one\n\n[^b]: two', WITH_SECTION);

    expect(el.querySelectorAll('.bear-footnote-section')).toHaveLength(1);
  });

  it('draws no header when the note has no definitions', () => {
    const { el } = mounted('Just prose, and a marker[^a].', WITH_SECTION);

    expect(el.querySelectorAll('.bear-footnote-section')).toHaveLength(0);
  });

  it('hides the definitions when collapsed, and restores them', () => {
    const { el } = mounted('A[^a].\n\n[^a]: one', WITH_SECTION);
    expect(el.querySelectorAll('.bear-fold-hidden')).toHaveLength(0);

    toggle(el);
    expect(el.querySelectorAll('.bear-fold-hidden')).toHaveLength(1);

    toggle(el);
    expect(el.querySelectorAll('.bear-fold-hidden')).toHaveLength(0);
  });

  it('reports its state to assistive technology', () => {
    const { el } = mounted('A[^a].\n\n[^a]: one', WITH_SECTION);
    const button = () => el.querySelector('[data-footnote-section-toggle]');

    expect(button()?.getAttribute('aria-expanded')).toBe('true');
    toggle(el);
    expect(button()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('puts no header text into the document', () => {
    // Chrome, not content. A UI-language string in the markdown would make the
    // note depend on the language selected at the last save.
    const { editor } = mounted('A[^a].\n\n[^a]: one', WITH_SECTION);

    expect(serializeMarkdown(editor.getJSON())).toBe('A[^a].\n\n[^a]: one');
  });

  it('draws no header at all when no label is injected', () => {
    // The same `null` contract every injected label follows: chrome with no
    // text is worse than no chrome.
    const { el } = mounted('A[^a].\n\n[^a]: one');

    expect(el.querySelectorAll('.bear-footnote-section')).toHaveLength(0);
  });
});

describe('footnote navigation', () => {
  const click = (element: Element | null) =>
    element?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );

  const flashed = (el: HTMLElement) => el.querySelector('.bear-heading-revealed');

  it('reveals the footnote when its marker is clicked', () => {
    const { el } = mounted('Alpha[^why] beta.\n\n[^why]: Because.', WITH_SECTION);

    click(el.querySelector('[data-footnote-ref]'));

    expect(flashed(el)?.textContent).toContain('Because.');
  });

  it('reveals it when the visible NUMBER is clicked', () => {
    // The number is a widget BESIDE the marker atom, not inside it, so a
    // handler that only accepted the marker would ignore the one element a
    // reader can actually see.
    const { el } = mounted('Alpha[^why] beta.\n\n[^why]: Because.', WITH_SECTION);

    click(el.querySelector('.bear-footnote-number'));

    expect(flashed(el)?.textContent).toContain('Because.');
  });

  it('returns to the first marker from the back link', () => {
    const { el } = mounted('A[^x] then B[^x] again.\n\n[^x]: Note.', WITH_SECTION);

    click(el.querySelector('[data-footnote-back]'));

    // The paragraph holding the FIRST reference.
    expect(flashed(el)?.textContent).toContain('A');
  });

  it('gives no back link to a footnote nobody references', () => {
    const { el } = mounted('[^orphan]: Nobody.', WITH_SECTION);

    expect(el.querySelectorAll('[data-footnote-back]')).toHaveLength(0);
  });

  it('does nothing when a marker has no footnote yet', () => {
    // Fail open, like an unresolved `[[link]]`: the click falls through and
    // places a caret rather than being swallowed.
    const { el } = mounted('Alpha[^ghost] beta.', WITH_SECTION);

    click(el.querySelector('[data-footnote-ref]'));

    expect(flashed(el)).toBeNull();
  });

  it('opens a collapsed section before jumping into it', () => {
    // Otherwise the marker appears to do nothing: the footnote is revealed
    // under `display: none`.
    const { el } = mounted('Alpha[^why] beta.\n\n[^why]: Because.', WITH_SECTION);
    click(el.querySelector('[data-footnote-section-toggle]'));
    expect(el.querySelectorAll('.bear-fold-hidden')).toHaveLength(1);

    click(el.querySelector('[data-footnote-ref]'));

    expect(el.querySelectorAll('.bear-fold-hidden')).toHaveLength(0);
  });

  it('puts nothing into the document', () => {
    const { editor, el } = mounted('Alpha[^why] beta.\n\n[^why]: Because.', WITH_SECTION);

    click(el.querySelector('[data-footnote-ref]'));

    expect(serializeMarkdown(editor.getJSON())).toBe('Alpha[^why] beta.\n\n[^why]: Because.');
  });

  /**
   * `TrailingNode`'s `appendTransaction` is not gated on `docChanged`, so a
   * meta-only dispatch without `skipTrailingNodeMeta` appends an empty
   * paragraph — which autosave writes back. EVERY note with footnotes ends in
   * one, so this would have fired on the first collapse of every such note.
   */
  it('collapsing does not touch a document that ends in a footnote', () => {
    const { editor, el } = mounted('A[^a].\n\n[^a]: one', WITH_SECTION);
    const before = serializeMarkdown(editor.getJSON());

    el.querySelector<HTMLElement>('[data-footnote-section-toggle]')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
  });

  it('marks a marker whose footnote is not written yet', () => {
    const { el } = mounted('Written[^a] and not[^b].\n\n[^a]: here', WITH_SECTION);
    const orphans = [...el.querySelectorAll('.bear-footnote-number--orphan')];

    expect(orphans.map((n) => n.textContent)).toEqual(['2']);
  });

  it('still numbers the orphan, so the sequence is not a lie', () => {
    const { el } = mounted('A[^a] B[^b] C[^c].\n\n[^b]: only this one', WITH_SECTION);

    expect(numbers(el)).toEqual(['1', '2', '3']);
  });
});
