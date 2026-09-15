import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorExtensions } from './extensions';
import { REVEAL_MS } from './HeadingReveal';

// Every test constructs a fresh editor and never destroys it directly; an
// undestroyed `Editor` leaves ProseMirror's `DOMObserver` polling on a
// `setTimeout` that outlives the test file's jsdom environment. Same header as
// `linkPill.test.ts`, for the same reason.
const createdEditors: Editor[] = [];

function mounted(html: string): { editor: Editor; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = new Editor({ extensions: editorExtensions, content: html, element: container });
  createdEditors.push(editor);
  return { editor, container };
}

afterEach(() => {
  while (createdEditors.length > 0) {
    createdEditors.pop()!.destroy();
  }
});

describe('revealHeading', () => {
  // Matched through `normalizeTitle`, the same key the link grammar and the
  // `[[` popover use — so a heading's own capitalisation never has to be
  // reproduced in the link that points at it. (Double spaces cannot be tested
  // from an HTML fixture: the parser collapses them before the editor sees
  // them. `splitLinkTarget`'s own suite covers the collapsing rule.)
  it('flashes the heading whose text matches, ignoring case', () => {
    const { editor, container } = mounted('<p>Title</p><h2>Roll BACK</h2><p>body</p>');

    expect(editor.commands.revealHeading('roll back')).toBe(true);
    expect(container.querySelector('.bear-heading-revealed')?.textContent).toBe('Roll BACK');
  });

  it('reports false for a heading the note does not have', () => {
    const { editor, container } = mounted('<p>Title</p><h2>Rollback</h2>');

    expect(editor.commands.revealHeading('gone')).toBe(false);
    expect(container.querySelector('.bear-heading-revealed')).toBeNull();
  });

  it('flashes only the first of two headings sharing a name', () => {
    const { editor, container } = mounted('<p>Title</p><h2>Dup</h2><p>a</p><h2>Dup</h2><p>b</p>');

    editor.commands.revealHeading('dup');

    expect(container.querySelectorAll('.bear-heading-revealed')).toHaveLength(1);
  });

  it('clears the flash after the timeout', () => {
    vi.useFakeTimers();
    try {
      const { editor, container } = mounted('<p>Title</p><h2>Rollback</h2><p>body</p>');
      editor.commands.revealHeading('rollback');
      expect(container.querySelector('.bear-heading-revealed')).not.toBeNull();

      vi.advanceTimersByTime(REVEAL_MS + 1);

      expect(container.querySelector('.bear-heading-revealed')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not touch the document', () => {
    // The whole point of a decoration. A flash that edited the note would
    // reach autosave, the Markdown, the export and the sync engine.
    const { editor } = mounted('<p>Title</p><h2>Rollback</h2><p>body</p>');
    const before = editor.getJSON();

    editor.commands.revealHeading('rollback');

    expect(editor.getJSON()).toEqual(before);
  });

  it('keeps the flash on its heading when text is inserted above it', () => {
    // The position is mapped through document changes rather than dropped:
    // the reader can type while the flash is still up, and a stale absolute
    // position would decorate whatever moved into it.
    const { editor, container } = mounted('<p>Title</p><h2>Rollback</h2><p>body</p>');
    editor.commands.revealHeading('rollback');

    editor.commands.insertContentAt(1, 'xxxx');

    expect(container.querySelector('.bear-heading-revealed')?.textContent).toBe('Rollback');
  });
});
