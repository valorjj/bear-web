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

  // Regression guard for the pointer-over-selection requirement itself.
  // `jsdom` has no `elementFromPoint`, so `view.posAtCoords` can't be driven
  // through real hit-testing (see the module header for why the two Range
  // stubs and the `elementFromPoint` stub above exist at all) — spying on
  // `posAtCoords` directly asserts which SOURCE the handler reads, not any
  // geometry, and goes red the instant the handler is changed to read
  // `state.selection` instead. Confirmed against a deliberately sabotaged
  // implementation (`const pos = view.state.selection.from`, pointer
  // ignored) that the earlier version of this suite passed unchanged; see
  // `task-6-report.md`'s fix-round-1 section for that run's output.
  it('resolves the position from the pointer, not the selection', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen, 'hello world');

    // Selection sits somewhere specific and known...
    editor.commands.setTextSelection(5);
    const selectionPos = editor.state.selection.from;

    // ...and the pointer reports a DIFFERENT, known position.
    const SENTINEL = 2;
    expect(SENTINEL).not.toBe(selectionPos);
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: SENTINEL, inside: -1 });

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].pos).toBe(SENTINEL);
    expect(onOpen.mock.calls[0][0].pos).not.toBe(selectionPos);
  });

  it('falls back to the selection when the pointer resolves to nothing', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen, 'hello world');

    editor.commands.setTextSelection(5);
    const selectionPos = editor.state.selection.from;

    // What `posAtCoords` actually returns for a point outside the document.
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].pos).toBe(selectionPos);
  });

  it('opens on Shift-F10', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen);

    expect(editor.commands.openContextMenu()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // Drives the actual keyboard binding through the view rather than calling
  // the command directly, so `addKeyboardShortcuts`' `'Shift-F10'` entry
  // itself is exercised, not just the command it points at.
  it('opens via a real Shift-F10 keydown dispatched at the view', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen);
    editor.view.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'F10',
      code: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('declines to open when nobody is listening', () => {
    const editor = editorWith(null);
    expect(editor.commands.openContextMenu()).toBe(false);
  });

  // CONTROLLER RULING R12 (fix round 1): the menu must preserve a real
  // selection the user right-clicks inside, rather than collapsing it to a
  // caret. Both routes carry the selection they saw, in `request.selection`.
  describe('R12: `request.selection`', () => {
    it('keyboard route: a real selection is reported as `{ from, to }`, a collapsed one as `null`', () => {
      const onOpen = vi.fn();
      const editor = editorWith(onOpen, 'hello world');

      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.openContextMenu();
      expect(onOpen.mock.calls[0][0].selection).toEqual({ from: 1, to: 6 });

      onOpen.mockClear();
      editor.commands.setTextSelection(3);
      editor.commands.openContextMenu();
      expect(onOpen.mock.calls[0][0].selection).toBeNull();
    });

    // Pointer route: read from the LIVE DOM `Selection`, not
    // `view.state.selection` — see `ContextMenuRequest.selection`'s own
    // docblock for why `state.selection` is not safe to trust here. This
    // sets a real DOM `Range`/`Selection` directly (jsdom supports both
    // without a layout engine) rather than going through
    // `editor.commands.setTextSelection`, so the test proves the handler
    // reads the DOM, not ProseMirror's model — a version reading
    // `state.selection` here would report `null` since nothing moved it.
    it('pointer route: reports the live DOM selection even when it differs from `state.selection`', () => {
      const onOpen = vi.fn();
      const editor = editorWith(onOpen, 'hello world');

      // jsdom's `Selection` silently refuses `addRange` on a node that isn't
      // connected to the document — confirmed directly, `new Editor(...)`
      // alone never attaches `view.dom` to `document.body`, and without this
      // append the selection below reports `rangeCount: 0` no matter what
      // range was added. Removed in `finally` so this test doesn't leak a
      // detached node into the shared jsdom document.
      document.body.appendChild(editor.view.dom);
      try {
        const textNode = editor.view.dom.querySelector('p')!.firstChild!;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 5); // "hello"
        const domSelection = document.getSelection();
        domSelection?.removeAllRanges();
        domSelection?.addRange(range);

        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        editor.view.dom.dispatchEvent(event);

        expect(onOpen).toHaveBeenCalledTimes(1);
        const request = onOpen.mock.calls[0][0];
        expect(request.selection).not.toBeNull();
        expect(request.selection.to - request.selection.from).toBe(5);
      } finally {
        editor.view.dom.remove();
      }
    });

    it('pointer route: reports `null` when the DOM selection is collapsed', () => {
      const onOpen = vi.fn();
      const editor = editorWith(onOpen, 'hello world');

      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen.mock.calls[0][0].selection).toBeNull();
    });
  });
});
