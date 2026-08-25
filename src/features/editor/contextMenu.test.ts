import { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';

import { ContextMenu, contextMenuKey, type ContextMenuOptions } from './ContextMenu';
import { editorExtensions } from './extensions';
import { parseMarkdown } from './markdown';

// jsdom has no layout engine, so ProseMirror's `coordsAtPos`/`posAtCoords`
// (reached here via `posToDOMRect` and `view.posAtCoords`) throw on APIs
// jsdom never implements. Same three stubs as `NoteEditor.test.tsx`'s header
// (see CLAUDE.md's jsdom toolchain note) — harmless empty geometry so the
// plugin's DOM-event and command paths can run without crashing.
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

function editorWith(onOpen: ContextMenuOptions['onOpen'], markdown = 'hello world'): Editor {
  return new Editor({
    extensions: [...editorExtensions, ContextMenu.configure({ onOpen })],
    content: parseMarkdown(markdown),
  });
}

describe('ContextMenu', () => {
  it('registers no plugin when nobody is listening', () => {
    const editor = editorWith(null);
    expect(editor.state.plugins.some((p) => p.spec.key === contextMenuKey)).toBe(false);
  });

  it('suppresses the browser menu and reports a request', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toHaveProperty('pos');
  });

  it('opens on Shift-F10', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen);

    expect(editor.commands.openContextMenu()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('declines to open when nobody is listening', () => {
    const editor = editorWith(null);
    expect(editor.commands.openContextMenu()).toBe(false);
  });
});
