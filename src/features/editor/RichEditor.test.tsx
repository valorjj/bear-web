import { isMacOS, type Editor } from '@tiptap/core';
import { fireEvent, screen } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle, type RichEditorProps } from './RichEditor';
import { tagRangeAt } from './TagPill';

describe('RichEditor', () => {
  it('renders the initial markdown as rich content', async () => {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
  });

  it('exposes the current markdown through its handle', async () => {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByRole('heading', { name: 'Hello' });
    expect(handleRef.current?.getMarkdown()).toBe('# Hello');
  });

  it('preserves an unsupported construct through the handle', async () => {
    const source = '| a |\n| --- |\n| b |';
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown={source}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByLabelText('Note text');
    expect(handleRef.current?.getMarkdown()).toBe(source);
  });
});

const baseProps: Omit<RichEditorProps, 'onActivateTag'> = {
  initialMarkdown: 'a #work b',
  onChange: vi.fn(),
  onBlur: vi.fn(),
  ariaLabel: 'Note text',
  handleRef: { current: null } as RefObject<RichEditorHandle | null>,
  createdAt: 0,
  updatedAt: 0,
};

/**
 * Locates the fixture's tag with `tagRangeAt` (the same grammar the plugin
 * itself uses to decide what a click landed on) and drives the plugin's own
 * `mousedown` handler with a fake view, mirroring `mousedownAt` in
 * `tagPill.test.ts` — no real layout is needed because `posAtCoords` is
 * stubbed rather than exercised.
 */
function activateFirstTag(editor: Editor): void {
  let hit: ReturnType<typeof tagRangeAt> = null;
  for (let pos = 0; pos <= editor.state.doc.content.size && hit === null; pos++) {
    hit = tagRangeAt(editor.state, pos);
  }
  if (hit === null) throw new Error('activateFirstTag: no tag found in fixture');

  const event = new MouseEvent('mousedown', {
    cancelable: true,
    button: 0,
    ...(isMacOS() ? { metaKey: true } : { ctrlKey: true }),
  });
  const at = hit.from + 1;
  const view = { state: editor.state, posAtCoords: () => ({ pos: at, inside: at }) };
  editor.view.someProp('handleDOMEvents', (handlers) =>
    handlers.mousedown === undefined ? false : handlers.mousedown(view as never, event as never),
  );
}

describe('RichEditor tag activation', () => {
  it('calls the CURRENT callback, not the one captured at mount', () => {
    // The plugin reads `onActivate` once, at construction. A prop passed
    // straight through would freeze the first render's closure.
    const first = vi.fn();
    const second = vi.fn();
    const handleRef: RefObject<RichEditorHandle | null> = { current: null };
    const { rerender } = renderWithI18n(
      <RichEditor {...baseProps} handleRef={handleRef} onActivateTag={first} />,
    );
    rerender(<RichEditor {...baseProps} handleRef={handleRef} onActivateTag={second} />);

    // Invoke through the mounted plugin, the same way tagPill.test.ts does.
    activateFirstTag(handleRef.current!.editor!);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('work');
  });

  it('marks the editor while the modifier is held, and clears it on blur', () => {
    renderWithI18n(<RichEditor {...baseProps} onActivateTag={vi.fn()} />);
    const surface = screen.getByRole('textbox').closest('[data-mod-held]');
    expect(surface).not.toBeNull();
    expect(surface!.getAttribute('data-mod-held')).toBe('false');

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true, ctrlKey: true });
    expect(surface!.getAttribute('data-mod-held')).toBe('true');

    fireEvent.keyUp(window, { key: 'Meta', metaKey: false, ctrlKey: false });
    expect(surface!.getAttribute('data-mod-held')).toBe('false');
  });

  // Hold Cmd, press Tab to switch windows, and the keyup never arrives. The
  // pills would keep claiming to be clickable while a plain click edits.
  it('clears the modifier state when the window loses focus', () => {
    renderWithI18n(<RichEditor {...baseProps} onActivateTag={vi.fn()} />);
    const surface = screen.getByRole('textbox').closest('[data-mod-held]')!;

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true, ctrlKey: true });
    expect(surface.getAttribute('data-mod-held')).toBe('true');

    fireEvent.blur(window);
    expect(surface.getAttribute('data-mod-held')).toBe('false');
  });
});
