import { act, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db, files, MAX_DISPLAY_WIDTH, storedImagePath } from '@/data';
import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle } from './RichEditor';

// jsdom has no layout engine and implements neither `coordsAtPos` nor
// `posAtCoords`; the same stubs `toolbars.test.tsx` and `NoteEditor.test.tsx`
// install, for the same reason.
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

function renderEditor(markdown: string): {
  unmount: () => void;
  handleRef: React.RefObject<RichEditorHandle | null>;
} {
  const handleRef = createRef<RichEditorHandle>();
  const result = renderWithI18n(
    <RichEditor
      initialMarkdown={markdown}
      onChange={vi.fn()}
      onBlur={vi.fn()}
      ariaLabel="Note text"
      handleRef={handleRef}
      createdAt={0}
      updatedAt={0}
    />,
  );
  return { unmount: result.unmount, handleRef };
}

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.files.clear()]);
  vi.restoreAllMocks();
});

describe('StoredImage', () => {
  it('renders an img for a stored image', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stored');
    const record = await files.add('n1', new Blob(['x'], { type: 'image/webp' }), {
      mime: 'image/webp',
      width: 40,
      height: 20,
    });

    renderEditor(`![beach](${storedImagePath(record.id)})`);

    const img = await waitFor(() => {
      const found = document.querySelector('img.bear-stored-image') as HTMLImageElement | null;
      expect(found?.getAttribute('src')).toBe('blob:stored');
      return found!;
    });
    expect(img.alt).toBe('beach');
    // Reserved from the RECORD, so the text does not reflow when the blob
    // lands. Without this every image in a long note shifts the prose twice.
    expect(img.width).toBe(40);
    expect(img.height).toBe(20);
  });

  it('shows a quiet placeholder for a file this device does not have', async () => {
    renderEditor(`![](${storedImagePath('nothere')})`);

    // NOT an error: after K2 this is the ordinary look of an image whose bytes
    // have not synced yet.
    expect(await screen.findByText('Image not on this device yet')).toBeInTheDocument();
    expect(document.querySelector('img.bear-stored-image')).toBeNull();
  });

  it('leaves a remote URL as monospace source, never fetching it', async () => {
    // The privacy property K1 preserves deliberately: opening a note must not
    // make a request to a third-party host.
    renderEditor('![remote](https://example.com/a.png)');

    await waitFor(() => {
      expect(document.querySelector('[data-raw-inline="rawImage"]')).not.toBeNull();
    });
    // `img.bear-stored-image`, not any `img`: ProseMirror inserts its own
    // `<img class="ProseMirror-separator">` into a paragraph holding only an
    // inline atom, so a bare `img` selector matches the editor's plumbing
    // rather than a rendered picture.
    expect(document.querySelector('img.bear-stored-image')).toBeNull();
  });

  it('renders at the width the Markdown asks for', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sized');
    const record = await files.add('n1', new Blob(['x'], { type: 'image/webp' }), {
      mime: 'image/webp',
      width: 800,
      height: 400,
    });

    renderEditor(`![beach|120](${storedImagePath(record.id)})`);

    const img = await waitFor(() => {
      const found = document.querySelector('img.bear-stored-image') as HTMLImageElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    // The CSS width, not the attribute: the attribute carries the STORED
    // dimensions so the box can be reserved, and a display width has to
    // override that without the two disagreeing.
    expect(img.style.width).toBe('120px');
    // The pipe belongs to the width, never to the alt text the reader hears.
    expect(img.alt).toBe('beach');
  });

  it('fills the column when no width is set', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unsized');
    const record = await files.add('n1', new Blob(['x'], { type: 'image/webp' }), {
      mime: 'image/webp',
      width: 800,
      height: 400,
    });

    renderEditor(`![beach](${storedImagePath(record.id)})`);

    const img = await waitFor(() => {
      const found = document.querySelector('img.bear-stored-image') as HTMLImageElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    // Not `0px`, which a careless `${width}px` on a null would produce and
    // which renders as an invisible image with no error anywhere.
    expect(img.style.width).toBe('');
  });

  it('revokes the object URL when the editor goes away', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gone');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const record = await files.add('n1', new Blob(['x'], { type: 'image/webp' }), {
      mime: 'image/webp',
      width: 10,
      height: 10,
    });

    const { unmount } = renderEditor(`![](${storedImagePath(record.id)})`);
    await waitFor(() => {
      expect(document.querySelector('img.bear-stored-image')).not.toBeNull();
    });

    unmount();

    // The ONLY thing that can see a leak. Nothing else in the app, the suite
    // or the browser reports an object URL that is never revoked.
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:gone'));
  });
});

describe('keyboard resize', () => {
  /** Mounts an editor with one stored image and selects it. */
  async function withSelectedImage(markdown: string) {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:resize');
    const { handleRef } = renderEditor(markdown);
    await waitFor(() => expect(handleRef.current?.editor).toBeTruthy());

    const editor = handleRef.current!.editor!;
    // Select the image node itself. A caret in prose is the state the
    // shortcuts must decline, so the tests have to be explicit about which
    // one they are in.
    let imagePos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'storedImage') imagePos = pos;
    });
    expect(imagePos).not.toBeNull();
    act(() => {
      editor.commands.setNodeSelection(imagePos!);
    });

    return { editor, handleRef };
  }

  function widthOf(handleRef: React.RefObject<RichEditorHandle | null>): number | null {
    const markdown = handleRef.current!.getMarkdown();
    const match = /!\[[^\]]*\|(\d+)\]/.exec(markdown);
    return match === null ? null : Number(match[1]);
  }

  it('narrows a selected image', async () => {
    const { editor, handleRef } = await withSelectedImage(
      'Note\n\ntext ![beach|400](files/abc.webp) more',
    );

    act(() => {
      editor.commands.keyboardShortcut('Mod-Alt-ArrowLeft');
    });

    // Asserted through the SERIALIZED markdown, not the DOM: a resize that
    // moved the element and never reached the document would look identical
    // on screen and be lost on reload.
    expect(widthOf(handleRef)!).toBeLessThan(400);
  });

  it('widens a selected image', async () => {
    const { editor, handleRef } = await withSelectedImage(
      'Note\n\ntext ![beach|400](files/abc.webp) more',
    );

    act(() => {
      editor.commands.keyboardShortcut('Mod-Alt-ArrowRight');
    });

    expect(widthOf(handleRef)!).toBeGreaterThan(400);
  });

  it('never goes below 1 or above the maximum', async () => {
    const { editor, handleRef } = await withSelectedImage(
      'Note\n\ntext ![beach|100](files/abc.webp) more',
    );

    for (let i = 0; i < 40; i += 1) {
      act(() => {
        editor.commands.keyboardShortcut('Mod-Alt-ArrowLeft');
      });
    }
    expect(widthOf(handleRef)!).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 60; i += 1) {
      act(() => {
        editor.commands.keyboardShortcut('Mod-Alt-ArrowRight');
      });
    }
    expect(widthOf(handleRef)!).toBeLessThanOrEqual(MAX_DISPLAY_WIDTH);
  });

  it('resets to full column, losing the pipe entirely', async () => {
    const { editor, handleRef } = await withSelectedImage(
      'Note\n\ntext ![beach|400](files/abc.webp) more',
    );

    act(() => {
      editor.commands.keyboardShortcut('Mod-Alt-0');
    });

    // `null`, never `|0`: the reset must round-trip to exactly what an
    // unresized image writes.
    expect(handleRef.current!.getMarkdown()).toContain('![beach](files/abc.webp)');
  });

  it('declines when the caret is in prose rather than on an image', async () => {
    // Otherwise the chords swallow themselves everywhere in a note, which is
    // most of the time.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prose');
    const { handleRef } = renderEditor('just words, no image');
    await waitFor(() => expect(handleRef.current?.editor).toBeTruthy());
    const before = handleRef.current!.getMarkdown();

    act(() => {
      handleRef.current!.editor!.commands.keyboardShortcut('Mod-Alt-ArrowLeft');
    });

    expect(handleRef.current!.getMarkdown()).toBe(before);
  });
});
