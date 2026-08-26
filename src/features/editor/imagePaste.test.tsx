import { waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle } from './RichEditor';

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

function renderEditor(onImage?: (file: Blob) => Promise<string | null>) {
  const handleRef = createRef<RichEditorHandle>();
  renderWithI18n(
    <RichEditor
      initialMarkdown="hello"
      onChange={vi.fn()}
      onBlur={vi.fn()}
      ariaLabel="Note text"
      handleRef={handleRef}
      createdAt={0}
      updatedAt={0}
      onImage={onImage}
    />,
  );
  return handleRef;
}

/**
 * A paste carrying `files`, dispatched at the editor's surface.
 *
 * jsdom implements neither `DataTransfer` nor a `ClipboardEvent` that accepts
 * one, so the payload is attached by hand.
 *
 * `getData` and `types` are supplied even though `ImagePaste` reads neither:
 * ProseMirror runs EVERY plugin's `handleDOMEvents.paste` in turn, and
 * `@tiptap/core`'s own handler calls `getData` before ours is reached — a
 * payload with only `files` makes it throw, and the throw is what stops our
 * handler running at all. That was a fault in this harness, not in the
 * plugin, and it took a stack trace to tell the two apart.
 */
function paste(files: File[]): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files, types: [], getData: () => '', items: [] },
  });
  document.querySelector('.ProseMirror')!.dispatchEvent(event);
  return event.defaultPrevented;
}

function imageFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
}

describe('ImagePaste', () => {
  it('hands a pasted image up and inserts what the callback returns', async () => {
    const onImage = vi.fn(async () => 'files/abc.webp');
    const handleRef = renderEditor(onImage);
    await waitFor(() => expect(handleRef.current).not.toBeNull());

    paste([imageFile()]);

    await waitFor(() => expect(onImage).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(handleRef.current!.getMarkdown()).toContain('![](files/abc.webp)');
    });
  });

  it('inserts nothing when the image is refused', async () => {
    // A 25MB paste is an ordinary mistake, not an error — the editor simply
    // does not gain a broken reference.
    const onImage = vi.fn(async () => null);
    const handleRef = renderEditor(onImage);
    await waitFor(() => expect(handleRef.current).not.toBeNull());

    paste([imageFile()]);

    await waitFor(() => expect(onImage).toHaveBeenCalledTimes(1));
    expect(handleRef.current!.getMarkdown()).not.toContain('![]');
  });

  it('ignores a paste with no image, so pasting text still pastes text', async () => {
    // The easy regression: claiming every paste.
    const onImage = vi.fn(async () => 'files/abc.webp');
    const handleRef = renderEditor(onImage);
    await waitFor(() => expect(handleRef.current).not.toBeNull());

    const prevented = paste([new File(['plain'], 'a.txt', { type: 'text/plain' })]);

    expect(prevented).toBe(false);
    expect(onImage).not.toHaveBeenCalled();
  });

  it('is inert when no handler was supplied', async () => {
    // Same rule as `ContextMenu.onOpen`: an unwired extension must not
    // preventDefault and swallow the browser's own behaviour.
    const handleRef = renderEditor(undefined);
    await waitFor(() => expect(handleRef.current).not.toBeNull());

    expect(paste([imageFile()])).toBe(false);
  });
});
