import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { linkDecorations, linkRangeAt, linkSyntaxDecorations } from './LinkPill';

// jsdom has no layout engine, so ProseMirror's `coordsAtPos`/`posAtCoords`
// (reached here via `view.posAtCoords`) throw on APIs jsdom never
// implements. Same three stubs as `contextMenu.test.ts`'s header (see
// CLAUDE.md's jsdom toolchain note) — harmless empty geometry so the
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

// Every test constructs a fresh editor and never destroys it directly; an
// undestroyed `Editor` leaves ProseMirror's `DOMObserver` polling on a
// `setTimeout` that outlives the test file's jsdom environment, throwing
// "document is not defined" into an uncaught exception once that environment
// tears down. Tracking every instance here and destroying them all in
// `afterEach` fixes that without touching each test's body.
const createdEditors: Editor[] = [];

function docFor(content: string, extensions = editorExtensions): Editor {
  const editor = new Editor({ extensions, content });
  createdEditors.push(editor);
  return editor;
}

afterEach(() => {
  while (createdEditors.length > 0) {
    createdEditors.pop()!.destroy();
  }
});

describe('link pill decorations', () => {
  it('decorates a link in a paragraph', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>See [[Deploy Checklist]] please</p>',
      element: container,
    });
    createdEditors.push(editor);

    expect(container.querySelectorAll('.bear-link')).toHaveLength(1);
    expect(container.querySelector('.bear-link')?.textContent).toBe('[[Deploy Checklist]]');
  });

  it('decorates every link, including a repeat', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>[[One]] then [[Two]] then [[One]]</p>',
      element: container,
    });
    createdEditors.push(editor);

    expect(container.querySelectorAll('.bear-link')).toHaveLength(3);
  });

  it('does not decorate a link inside a fenced code block', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<pre><code>[[Not A Link]]</code></pre>',
      element: container,
    });
    createdEditors.push(editor);

    expect(container.querySelectorAll('.bear-link')).toHaveLength(0);
  });

  it('does not decorate a link inside an inline code span', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>a <code>[[x]]</code> b</p>',
      element: container,
    });
    createdEditors.push(editor);

    expect(container.querySelectorAll('.bear-link')).toHaveLength(0);
  });

  it('marks a link to a known title as resolved', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>See [[Deploy Checklist]]</p>',
      element: container,
    });
    createdEditors.push(editor);

    editor.commands.setKnownNoteTitles(['Deploy Checklist']);

    const pill = container.querySelector('.bear-link');
    expect(pill?.getAttribute('data-resolved')).toBe('true');
  });

  it('marks a link to an unknown title as unresolved', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>See [[Nothing Here]]</p>',
      element: container,
    });
    createdEditors.push(editor);

    editor.commands.setKnownNoteTitles(['Deploy Checklist']);

    const pill = container.querySelector('.bear-link');
    expect(pill?.getAttribute('data-resolved')).toBe('false');
  });

  it('resolves case-insensitively and across whitespace, via normalizeTitle', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>See [[deploy   CHECKLIST]]</p>',
      element: container,
    });
    createdEditors.push(editor);

    editor.commands.setKnownNoteTitles(['Deploy Checklist']);

    const pill = container.querySelector('.bear-link');
    expect(pill?.getAttribute('data-resolved')).toBe('true');
  });

  it('re-resolves when the known-title set is replaced, not merged', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>See [[Deploy Checklist]]</p>',
      element: container,
    });
    createdEditors.push(editor);

    editor.commands.setKnownNoteTitles(['Deploy Checklist']);
    expect(container.querySelector('.bear-link')?.getAttribute('data-resolved')).toBe('true');

    // The set is replaced wholesale, not merged: a title present a moment ago
    // (a note renamed or trashed since) must stop resolving.
    editor.commands.setKnownNoteTitles(['Something Else']);
    expect(container.querySelector('.bear-link')?.getAttribute('data-resolved')).toBe('false');
  });
});

describe('linkRangeAt', () => {
  it('finds the link covering a position inside it', () => {
    const editor = docFor('<p>a [[Note]] b</p>');
    // '[[Note]]' occupies positions 3..11: paragraph starts at 0, its text at
    // 1, so 'a ' is 1..3 and '[' is at 3.
    const hit = linkRangeAt(editor.state, 5);
    expect(hit).toEqual({ title: 'note', from: 3, to: 11 });
    expect(editor.state.doc.textBetween(hit!.from, hit!.to)).toBe('[[Note]]');
  });

  it('returns null for ordinary prose', () => {
    const editor = docFor('<p>a [[Note]] b</p>');
    expect(linkRangeAt(editor.state, 1)).toBeNull();
    expect(linkRangeAt(editor.state, 13)).toBeNull();
  });

  it('returns null inside a code block', () => {
    const editor = docFor('<pre><code>[[Note]]</code></pre>');
    expect(linkRangeAt(editor.state, 3)).toBeNull();
  });

  it('returns null at a position between two blocks', () => {
    const editor = docFor('<p>[[One]]</p><p>[[Two]]</p>');
    const boundary = editor.state.doc.firstChild!.nodeSize;
    expect(editor.state.doc.resolve(boundary).depth).toBe(0);
    expect(linkRangeAt(editor.state, boundary)).toBeNull();
  });
});

/**
 * Invokes the plugin's own mousedown handler with a fake view, so the test
 * exercises the real registered plugin without needing jsdom layout —
 * `posAtCoords` has no meaning without a layout engine. Mirrors
 * `tagPill.test.ts`'s `mousedownAt` exactly.
 */
function mousedownAt(
  editor: Editor,
  pos: number,
  init: MouseEventInit,
): { handled: boolean; defaultPrevented: boolean } {
  const event = new MouseEvent('mousedown', { cancelable: true, button: 0, ...init });
  const view = { state: editor.state, posAtCoords: () => ({ pos, inside: pos }) };
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.mousedown === undefined ? false : handlers.mousedown(view as never, event as never),
    ) === true;
  return { handled, defaultPrevented: event.defaultPrevented };
}

/**
 * An `onActivateLink` that records the titles it is asked about and answers
 * with `answer`. The boolean is the app's half of the contract: `true` means
 * the app acted on the link, and only then may the plugin consume the event.
 */
function recording(into: string[], answer = true): (title: string) => boolean {
  return (title) => {
    into.push(title);
    return answer;
  };
}

describe('link activation', () => {
  it('reports the NORMALIZED title and swallows the event on a plain click', () => {
    const activated: string[] = [];
    const editor = docFor(
      '<p>a [[Deploy   CHECKLIST]] b</p>',
      buildEditorExtensions({ onActivateLink: recording(activated) }),
    );

    const result = mousedownAt(editor, 5, {});

    expect(activated).toEqual(['deploy checklist']);
    expect(result.handled).toBe(true);
    expect(result.defaultPrevented).toBe(true);
  });

  // The property worth injecting a fault against, now that no modifier gates
  // the gesture: a DECLINED link must leave the event completely alone, so
  // ProseMirror's own mousedown handling still places the caret. This is the
  // whole of what keeps an unresolved `[[link]]` editable by pointer —
  // perturbing the handler to `preventDefault()` unconditionally must fail
  // exactly here, and nothing else in this file would notice.
  it('leaves the event alone when the app declines the link, so the caret still moves', () => {
    const asked: string[] = [];
    const editor = docFor(
      '<p>a [[Note]] b</p>',
      buildEditorExtensions({ onActivateLink: recording(asked, false) }),
    );

    const result = mousedownAt(editor, 5, {});

    expect(asked).toEqual(['note']);
    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);
  });

  it('does nothing on a click outside any link', () => {
    const activated: string[] = [];
    const editor = docFor(
      '<p>a [[Note]] b</p>',
      buildEditorExtensions({ onActivateLink: recording(activated) }),
    );

    const result = mousedownAt(editor, 1, {});

    expect(activated).toEqual([]);
    expect(result.handled).toBe(false);
  });

  it('does not activate on a non-primary button', () => {
    const activated: string[] = [];
    const editor = docFor(
      '<p>a [[Note]] b</p>',
      buildEditorExtensions({ onActivateLink: recording(activated) }),
    );

    expect(mousedownAt(editor, 5, { button: 1 }).handled).toBe(false);
    expect(mousedownAt(editor, 5, { button: 2 }).handled).toBe(false);
    expect(activated).toEqual([]);
  });

  // Half of the old modifier rule survives the move to a plain click, and
  // only on Apple platforms. `isMacOS()` reads `navigator.platform`, which
  // jsdom reports as `''` — so a test that merely BRANCHES on `isMacOS()`
  // exercises the non-Apple arm on every machine and leaves the Apple arm
  // guarded by nothing. Each test below stubs the platform explicitly, the
  // same shape `tagPill.test.ts` settled on for the same reason.
  it('on an Apple platform, a plain click opens and Ctrl-click does not', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const activated: string[] = [];
      const editor = docFor(
        '<p>a [[Note]] b</p>',
        buildEditorExtensions({ onActivateLink: recording(activated) }),
      );

      // Ctrl-click on macOS is the context-menu gesture, and it arrives as
      // `button === 0` with `ctrlKey` set. It must not ALSO navigate, or one
      // gesture opens a menu and leaves the note the menu belongs to.
      const ctrl = mousedownAt(editor, 5, { ctrlKey: true });
      const plain = mousedownAt(editor, 5, {});

      expect(ctrl.handled).toBe(false);
      expect(plain.handled).toBe(true);
      expect(activated).toEqual(['note']);
    } finally {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it('off Apple platforms, Ctrl-click opens too, because Ctrl is not the menu gesture there', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    try {
      const activated: string[] = [];
      const editor = docFor(
        '<p>a [[Note]] b</p>',
        buildEditorExtensions({ onActivateLink: recording(activated) }),
      );

      expect(mousedownAt(editor, 5, { ctrlKey: true }).handled).toBe(true);
      expect(activated).toEqual(['note']);
    } finally {
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it('is inert when no callback is injected', () => {
    const editor = docFor('<p>a [[Note]] b</p>', editorExtensions);

    const result = mousedownAt(editor, 5, {});

    expect(result.handled).toBe(false);
  });

  it('puts the injected hint on every pill', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor({
      extensions: buildEditorExtensions({ linkActivateHint: 'Open this note' }),
      content: '<p>[[One]] and [[Two]]</p>',
      element: container,
    });
    createdEditors.push(editor);

    const pills = container.querySelectorAll('.bear-link');
    expect(pills).toHaveLength(2);
    pills.forEach((pill) => expect(pill.getAttribute('title')).toBe('Open this note'));
  });
});

describe('link syntax decorations', () => {
  /**
   * Brackets collapse on a RESOLVED pill only. An unresolved link carries no
   * fill at all — muted text plus a dashed underline (`editor.css`) — so the
   * `[[` `]]` are the only thing distinguishing "a link to a note I have not
   * written yet" from ordinary prose. Hiding them there would erase the
   * signal; hiding them on a filled pill costs nothing, because the pill
   * itself is the signal.
   */
  it('collapses both brackets of a resolved pill', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>see [[Notes]] here</p>',
    });
    const pills = linkDecorations(editor.state, new Set(['notes']));
    const syntax = linkSyntaxDecorations(pills);

    expect(syntax).toHaveLength(2);
    for (const { from, to } of syntax) {
      expect(editor.state.doc.textBetween(from, to)).toMatch(/^(\[\[|\]\])$/);
    }
    editor.destroy();
  });

  it('leaves an unresolved pill with its brackets visible', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>see [[Nope]] here</p>',
    });
    const pills = linkDecorations(editor.state, new Set());

    expect(pills).toHaveLength(1);
    expect(linkSyntaxDecorations(pills)).toHaveLength(0);
    editor.destroy();
  });

  it('collapses nothing while the caret is inside the link', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>see [[Notes]] here</p>',
    });
    const full = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    editor.commands.setTextSelection(1 + full.indexOf('[[Notes]]') + 3);

    expect(linkDecorations(editor.state, new Set(['notes']))).toHaveLength(0);
    expect(linkSyntaxDecorations(linkDecorations(editor.state, new Set(['notes'])))).toHaveLength(
      0,
    );
    editor.destroy();
  });
});
