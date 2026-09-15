import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';

const createdEditors: Editor[] = [];

function mounted(markdown: string): { editor: Editor; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    extensions: editorExtensions,
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
