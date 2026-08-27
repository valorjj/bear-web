import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';

const LABELS = {
  info: '정보',
  tip: '팁',
  success: '성공',
  warning: '경고',
  danger: '위험',
} as const;

/**
 * The editor's Markdown, without the trailing blank block.
 *
 * StarterKit registers `trailingNode`, which appends an empty paragraph
 * whenever the document ends in something that is not a textblock — a
 * blockquote, here. It appears after ANY interaction, including a bare
 * `setTextSelection`, so it is nothing to do with the callout commands;
 * verified by isolating each step. Trimming it is what lets these assertions
 * be exact strings rather than fuzzy `toContain` checks.
 */
function markdownOf(editor: Editor): string {
  return serializeMarkdown(editor.getJSON()).trimEnd();
}

function mount(markdown: string, withLabels = true): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: buildEditorExtensions(withLabels ? { calloutLabels: LABELS } : {}),
    content: parseMarkdown(markdown),
  });
}

describe('callout rendering', () => {
  it('marks the blockquote with its type so the stylesheet can find it', () => {
    const editor = mount('> [!warning] Be careful\n>\n> Body.');
    const quote = editor.view.dom.querySelector('blockquote');

    expect(quote?.getAttribute('data-callout')).toBe('warning');
    expect(quote?.querySelector('[data-callout-title]')?.textContent).toBe('Be careful');

    editor.destroy();
  });

  it('leaves a plain blockquote unmarked, so it keeps the quote styling', () => {
    const editor = mount('> just a quote');
    const quote = editor.view.dom.querySelector('blockquote');

    expect(quote?.hasAttribute('data-callout')).toBe(false);
    expect(quote?.querySelector('[data-callout-title]')).toBeNull();

    editor.destroy();
  });

  it('carries an unrecognised marker on the element without giving it a type', () => {
    const editor = mount('> [!사내공지] 제목\n>\n> 본문.');
    const quote = editor.view.dom.querySelector('blockquote');

    expect(quote?.hasAttribute('data-callout')).toBe(false);
    expect(quote?.getAttribute('data-callout-raw')).toBe('사내공지');

    editor.destroy();
  });
});

describe('the empty-header placeholder', () => {
  it('names the type when the header is empty', () => {
    const editor = mount('> [!warning]');
    const title = editor.view.dom.querySelector('[data-callout-title]');

    expect(title?.getAttribute('data-placeholder')).toBe('경고');

    editor.destroy();
  });

  it('disappears once the header has text', () => {
    // The assertion that can actually regress: a decoration that never
    // re-evaluates would leave the hint sitting behind the user's own title.
    const editor = mount('> [!warning] Be careful\n>\n> Body.');
    const title = editor.view.dom.querySelector('[data-callout-title]');

    expect(title?.hasAttribute('data-placeholder')).toBe(false);

    editor.destroy();
  });

  it('is absent entirely without labels, which is every build outside the editor', () => {
    // `renderNoteBody` builds its schema from the default extensions, so this
    // is what an export sees. The hint is a writer's aid, never content, and
    // it must not be able to reach a note's text or a rendered file.
    const editor = mount('> [!warning]', false);
    const title = editor.view.dom.querySelector('[data-callout-title]');

    expect(title?.hasAttribute('data-placeholder')).toBe(false);

    editor.destroy();
  });
});

describe('setCalloutType', () => {
  it('turns a plain paragraph into a callout with an empty header', () => {
    const editor = mount('Plain text.');
    editor.commands.setTextSelection(3);
    editor.commands.setCalloutType('tip');

    expect(markdownOf(editor)).toBe('> [!tip]\n>\n> Plain text.');

    editor.destroy();
  });

  it('switches an existing callout without disturbing its header or body', () => {
    const editor = mount('> [!warning] Be careful\n>\n> Body.');
    editor.commands.setTextSelection(6);
    editor.commands.setCalloutType('danger');

    expect(markdownOf(editor)).toBe('> [!danger] Be careful\n>\n> Body.');

    editor.destroy();
  });

  it('turns a plain quote into a callout', () => {
    const editor = mount('> quoted');
    editor.commands.setTextSelection(4);
    editor.commands.setCalloutType('info');

    expect(markdownOf(editor)).toBe('> [!info]\n>\n> quoted');

    editor.destroy();
  });

  it('keeps the header’s words when going back to a plain quote', () => {
    // The header is the user's text. Dropping it on the way back to a quote
    // would be silent data loss for one menu click.
    const editor = mount('> [!warning] Be careful\n>\n> Body.');
    editor.commands.setTextSelection(6);
    editor.commands.setCalloutType(null);

    expect(markdownOf(editor)).toBe('> Be careful\n>\n> Body.');

    editor.destroy();
  });

  it('clears an unrecognised marker when a real type is chosen', () => {
    const editor = mount('> [!사내공지] 제목\n>\n> 본문.');
    editor.commands.setTextSelection(4);
    editor.commands.setCalloutType('info');

    const out = markdownOf(editor);
    expect(out).toContain('[!info]');
    expect(out).not.toContain('사내공지');

    editor.destroy();
  });

  it('leaves the document editable afterwards', () => {
    // The failure this guards is the one CLAUDE.md records from K1: an invalid
    // document is accepted silently and every LATER transaction throws
    // `Called contentMatchAt on a node with invalid content`. Serializing
    // cannot see it; typing can.
    const editor = mount('Plain text.');
    editor.commands.setTextSelection(3);
    editor.commands.setCalloutType('tip');

    expect(() => editor.commands.insertContent('more')).not.toThrow();
    expect(markdownOf(editor)).toContain('more');

    editor.destroy();
  });
});
