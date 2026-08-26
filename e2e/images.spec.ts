import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * The only place in the suite a REAL WebP is produced. jsdom implements
 * neither `createImageBitmap` nor `OffscreenCanvas`, so the unit tests inject
 * both and cover the arithmetic; the encode itself can only run here.
 */
async function pasteImage(page: Page, size = { width: 40, height: 20 }): Promise<void> {
  await page.evaluate(async (dimensions) => {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#44aa77';
    context.fillRect(0, 0, dimensions.width, dimensions.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/png'),
    );
    if (blob === null) throw new Error('no blob');

    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, size);
}

async function newNote(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.pressSequentially('Screenshot note');
}

test('a pasted image is stored, rendered, and survives a reload', async ({ page }) => {
  await newNote(page);

  await pasteImage(page);

  const image = page.locator('.ProseMirror img.bear-stored-image');
  await expect(image).toHaveAttribute('src', /^blob:/);

  // The BYTES, not just the element: a broken image still has a src, and a
  // failed WebP encode would produce exactly that.
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // Polled, not read once: autosave is debounced, so a single read races the
  // write and comes back with the text as it was before the paste.
  const readNotes = async (): Promise<string> =>
    page.evaluate(async () => {
      const open = indexedDB.open('bear-web');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const rows = await new Promise<{ text: string }[]>((resolve) => {
        const request = database.transaction('notes').objectStore('notes').getAll();
        request.onsuccess = () => resolve(request.result as { text: string }[]);
      });
      database.close();
      return rows.map((row) => row.text).join('\n');
    });

  // The Markdown is a relative path, which is the contract sync and export
  // both depend on.
  await expect.poll(readNotes).toMatch(/!\[\]\(files\/[A-Za-z0-9_-]+\.webp\)/);

  await page.reload();
  await page.getByRole('button', { name: /Screenshot note/ }).click();
  await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveAttribute('src', /^blob:/);
});

test('the stored image is a WebP, downscaled from the source', async ({ page }) => {
  await newNote(page);

  // 3000px wide — over the 2048 cap, so the stored copy must be smaller than
  // what was pasted.
  await pasteImage(page, { width: 3000, height: 1500 });
  await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveAttribute('src', /^blob:/);

  const stored = await page.evaluate(async () => {
    const open = indexedDB.open('bear-web');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise<{ mime: string; width: number; height: number }[]>((resolve) => {
      const request = database.transaction('files').objectStore('files').getAll();
      request.onsuccess = () =>
        resolve(request.result as { mime: string; width: number; height: number }[]);
    });
    database.close();
    return rows[0];
  });

  expect(stored.mime).toBe('image/webp');
  expect(stored.width).toBe(2048);
  expect(stored.height).toBe(1024);
});

test('a remote image URL still renders as source, never as a picture', async ({ page }) => {
  // The privacy property K1 preserves deliberately: opening a note must not
  // fetch from a third-party host.
  //
  // SEEDED, not typed. Typing `![x](url)` puts literal characters in a text
  // node, and serializing a text node escapes them — the note round-trips to
  // `!\[x\](url)` and never becomes an image token at all, so a typed version
  // of this test would pass no matter what the parser did. The same escaping
  // is why `ImagePaste` inserts a NODE rather than text.
  let requested = false;
  await page.route('https://example.com/**', (route) => {
    requested = true;
    return route.abort();
  });

  await seedDatabase(page, {
    notes: [
      {
        id: 'remote',
        title: 'Remote image',
        text: 'Remote image\n\n![remote](https://example.com/a.png)',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Remote image/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();

  await expect(page.locator('.ProseMirror [data-raw-inline="rawImage"]')).toHaveCount(1);
  // `img.bear-stored-image`, not any `img`: ProseMirror inserts its own
  // `<img class="ProseMirror-separator">` into a paragraph holding only an
  // inline atom, so a bare `img` selector matches the editor's plumbing rather
  // than a rendered picture. That separator appeared once K3 started wrapping
  // a top-level inline node in a paragraph, and it is not a regression — the
  // request counter below is the assertion that actually protects the user.
  await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveCount(0);
  // The assertion that actually protects the user: no request left the page.
  //
  // This FAILED when first written, and the failure was real. The note-list
  // row's thumbnail read the first remote image URL out of the Markdown and
  // rendered it, so opening the app fetched from a third-party host — while
  // the editor, correctly, made no request at all. The row rendered the image,
  // the request went out, the route aborted it and the row's own `onError`
  // removed the element, so counting `<img>` afterwards found nothing and the
  // only evidence was this counter. The thumbnail now reads STORED images
  // only.
  expect(requested).toBe(false);
});
