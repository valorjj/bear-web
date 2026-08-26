import { screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db, files, storedImagePath } from '@/data';
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

function renderEditor(markdown: string): { unmount: () => void } {
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
  return { unmount: result.unmount };
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
    expect(document.querySelector('img')).toBeNull();
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
