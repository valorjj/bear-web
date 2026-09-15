import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';

const createdEditors: Editor[] = [];

/**
 * Mounted WITH a callback by default. The plugin registers nothing when
 * `onEditLink` is `null` — see the inert test at the end — so a fixture built
 * from the schema-only `editorExtensions` would be asserting that contract
 * rather than the affordance, which is how four of these tests failed first.
 */
const WIRED = buildEditorExtensions({ onEditLink: () => {}, linkEditLabel: 'Edit link' });

function mounted(html: string, extensions = WIRED): { editor: Editor; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({ extensions, content: html, element: el });
  createdEditors.push(editor);
  return { editor, el };
}

afterEach(() => {
  while (createdEditors.length > 0) {
    createdEditors.pop()!.destroy();
  }
});

/** Dispatches a real `mouseover` at `target`, the way the plugin receives it. */
function hover(el: HTMLElement, target: Element | null): void {
  (target ?? el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

const LINKED = '<p>See <a href="https://example.com">test link</a> no man</p>';

describe('the link edit affordance', () => {
  it('shows nothing at rest', () => {
    const { el } = mounted(LINKED);

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(0);
  });

  it('appears when the link is hovered', () => {
    const { el } = mounted(LINKED);

    hover(el, el.querySelector('a'));

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(1);
  });

  it('stays while the pointer moves onto the button itself', () => {
    // Without this the affordance is unreachable: it vanishes the instant the
    // pointer leaves the link text, which is the only way to get to it.
    const { el } = mounted(LINKED);
    hover(el, el.querySelector('a'));

    hover(el, el.querySelector('.bear-link-edit button'));

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(1);
  });

  it('goes away when the pointer moves to ordinary prose', () => {
    const { el } = mounted(LINKED);
    hover(el, el.querySelector('a'));

    hover(el, el.querySelector('p'));

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(0);
  });

  it('appears when the caret is inside a link, with no pointer at all', () => {
    // A phone has no hover, and a keyboard user has no pointer. The caret is
    // the route for both.
    const { editor, el } = mounted(LINKED);

    editor.commands.setTextSelection(8);

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(1);
  });

  it('shows one button per hovered link, not one per link in the note', () => {
    const { el } = mounted(
      '<p><a href="https://a.test">one</a> and <a href="https://b.test">two</a></p>',
    );

    hover(el, el.querySelector('a'));

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(1);
  });

  it('reports the link range when the button is pressed', () => {
    const calls: Array<[number, number]> = [];
    const { el } = mounted(
      LINKED,
      buildEditorExtensions({
        onEditLink: (from: number, to: number) => calls.push([from, to]),
        linkEditLabel: 'Edit link',
      }),
    );
    hover(el, el.querySelector('a'));

    el.querySelector<HTMLElement>('.bear-link-edit button')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    );

    // `See ` is 4 characters from position 1, so the link runs 5..14.
    expect(calls).toEqual([[5, 14]]);
  });

  it('carries the injected label, so no string is hardcoded in the plugin', () => {
    const { el } = mounted(
      LINKED,
      buildEditorExtensions({ onEditLink: () => {}, linkEditLabel: 'Edit link' }),
    );
    hover(el, el.querySelector('a'));

    expect(el.querySelector('.bear-link-edit button')?.getAttribute('aria-label')).toBe(
      'Edit link',
    );
  });

  it('does not touch the document', () => {
    // A decoration, so nothing about this can reach the markdown, an export
    // or the sync engine.
    const { editor, el } = mounted(LINKED);
    const before = editor.getJSON();

    hover(el, el.querySelector('a'));

    expect(editor.getJSON()).toEqual(before);
  });

  it('registers no plugin at all when no callback is injected', () => {
    // The same `null` contract `onActivateLink` and `codeLabels` follow: a
    // control that cannot do anything is worse than no control.
    const { editor, el } = mounted(LINKED, editorExtensions);

    editor.commands.setTextSelection(8);

    expect(el.querySelectorAll('.bear-link-edit')).toHaveLength(0);
  });
});
