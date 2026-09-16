import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The only test that can catch a wrong path rewrite end to end. Every unit
 * test up to this point proves the exporter and the parser agree with each
 * other, which is not evidence — the same reason `e2e/imageExport.spec.ts`'s
 * `/usr/bin/unzip -t` is the only thing in the repo that can see a bad
 * CRC-32. This one publishes a REAL exported document (the sender's own
 * `Export note` → `HTML`, not a fixture) and imports it in a fresh browser
 * context, then reads the recipient's IndexedDB back with the raw API to
 * confirm the imported note's `files/<id>.webp` reference points at bytes
 * this device actually holds.
 *
 * The sender's `page` opts OUT of the shared `storageState` that pre-
 * dismisses the landing gate for every other spec — it needs to enter as a
 * guest like any first-time visitor before it has a note to export. The
 * recipient is not a second page in the SAME context: two pages in one
 * `BrowserContext` share the same origin's `localStorage` and IndexedDB, so
 * reusing the sender's context would hand the recipient the sender's own
 * landing-seen flag and its notes already on the doorstep — nothing left to
 * test. `browser.newContext()` gives the recipient a truly separate device,
 * which is what a real recipient is.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Pastes a REAL, freshly-encoded WebP — generated on canvas in the real
 * browser, not a hardcoded literal — so two calls with different `size`/
 * `noise` produce two genuinely different images with two different encoded
 * byte lengths. With only ONE image in the note, every path in the text
 * necessarily maps to the one blob that exists, so a bug that mismatched
 * blob to path entirely (e.g. reused the same blob for every reference, or
 * dropped a per-image loop variable) would still pass. Two distinctly-sized
 * images at least forces two DISTINCT file rows to exist and both text
 * references to resolve to real, differently-sized bytes — the residual gap
 * (a pure index swap between two images pasted and therefore also
 * text-ordered identically) would need a reordering the real export
 * pipeline does not produce, which is more than a few lines and is left
 * open rather than attempted here.
 */
async function pasteImage(
  page: Page,
  options: { size: number; noise: boolean; filename: string },
): Promise<void> {
  await page.evaluate(async ({ size, noise, filename }) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    if (noise) {
      // Noise compresses far worse than a flat fill, which is what makes the
      // two images' encoded sizes reliably differ rather than merely their
      // dimensions.
      const imageData = ctx.createImageData(size, size);
      for (let i = 0; i < imageData.data.length; i += 1) {
        imageData.data[i] = Math.floor(Math.random() * 256);
      }
      imageData.data[3] = 255;
      ctx.putImageData(imageData, 0, 0);
    } else {
      ctx.fillStyle = '#336699';
      ctx.fillRect(0, 0, size, size);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result === null) reject(new Error('toBlob produced nothing'));
        else resolve(result);
      }, 'image/webp');
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], filename, { type: 'image/webp' }));
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, options);
}

test('a shared document imports as a note with its image', async ({ page, browser }) => {
  // The sender's side: enter as a guest, write a note with a real stored
  // image, and export it through the app's OWN Export → HTML path — the
  // same UI `e2e/imageExport.spec.ts` drives, and the reason is the same:
  // a fixture document would only prove the parser matches itself, never
  // that the real exporter still emits what the parser expects.
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as guest' }).click();

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Shared note');
  await page.keyboard.press('Enter');

  // Two VISIBLY different images, so the round trip can catch a wrong
  // blob↔path pairing, not just a missing one — see `pasteImage`'s doc.
  await pasteImage(page, { size: 64, noise: true, filename: 'noisy.webp' });
  await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveAttribute('src', /^blob:/);
  await page.keyboard.press('Enter');
  await pasteImage(page, { size: 4, noise: false, filename: 'flat.webp' });
  await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export note' }).click();
  await page.getByRole('menuitem', { name: 'HTML' }).click();
  const file = await download;

  // Saved to a real path and read back as a string rather than reading the
  // in-memory `Download` object directly — `imageExport.spec.ts` does the
  // same, because Playwright's own download path carries no extension and
  // some readers key off one. A plain string read is all this test needs.
  const dir = await mkdtemp(join(tmpdir(), 'bear-import-'));
  let document: string;
  try {
    const path = join(dir, 'note.html');
    await file.saveAs(path);
    document = await readFile(path, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  expect(document).toContain('id="bear-source"');
  expect(document).toContain('data-src="files/');

  // The recipient's side: a FRESH browser context — a different device, not
  // a second page in the sender's — whose `/share/<id>` answers with the
  // document the sender just produced.
  const recipientContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const recipient = await recipientContext.newPage();
    await recipient.route('**/share/page-abc', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: document }),
    );

    await recipient.goto('/?import=page-abc');

    // The landing gate first, because a recipient is a first-time visitor.
    await recipient.getByRole('button', { name: 'Continue as guest' }).click();

    const sheet = recipient.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(recipient.getByText('2 images')).toBeVisible();

    await recipient.getByRole('button', { name: 'Add to my notes' }).click();
    await expect(sheet).toBeHidden();

    // The assertion that matters: the imported note points at an image this
    // device actually holds, under an id of its OWN, and the bytes are real.
    //
    // Read through the RAW IndexedDB API rather than `import('/src/data/
    // index.ts')` — that specifier only resolves under Vite's dev server,
    // and `playwright.config.ts`'s webServer runs the built preview instead
    // (`npm run build && npm run preview`), where a bare `/src/...` import
    // 404s. `e2e/fixtures/seed.ts` reads and writes this same database the
    // same way, opening at version 60 (Dexie's declared version 6, times
    // ten) for the identical reason.
    interface Check {
      ok: boolean;
      why?: string;
      sizes?: number[];
      noteId?: string;
    }

    // Both images' paths must resolve, and to blobs of DIFFERING sizes — a
    // single-image round trip cannot tell a correct blob↔path pairing from
    // one that simply matched by document order (see `pasteImage`'s doc).
    const check = await recipient.evaluate(async (): Promise<Check> => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('bear-web', 60);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('database blocked'));
      });

      const allNotes = await new Promise<{ id: string; title: string; text: string }[]>(
        (resolve, reject) => {
          const store = database.transaction('notes', 'readonly').objectStore('notes');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        },
      );

      const imported = allNotes.find((note) => note.title === 'Shared note');
      if (imported === undefined) return { ok: false, why: 'no imported note' };

      const matches = [...imported.text.matchAll(/files\/([A-Za-z0-9_-]+)\.webp/g)];
      if (matches.length !== 2) {
        return { ok: false, why: `expected 2 image paths, found ${matches.length}` };
      }

      const sizes: number[] = [];
      for (const match of matches) {
        const record = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => {
          const store = database.transaction('files', 'readonly').objectStore('files');
          const req = store.get(match[1]!);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (record === undefined) return { ok: false, why: 'image path points at nothing' };
        sizes.push(record.blob.size);
      }

      database.close();

      return { ok: true, sizes, noteId: imported.id };
    });

    expect(check.ok, check.why).toBe(true);
    expect(check.sizes![0]).toBeGreaterThan(0);
    expect(check.sizes![1]).toBeGreaterThan(0);
    // A wrong document-order pairing would still produce two positive sizes;
    // requiring them to DIFFER is what actually exercises the pairing, since
    // the noisy 64×64 source and the flat 4×4 source encode to very
    // different byte lengths.
    expect(check.sizes![0]).not.toBe(check.sizes![1]);

    // The URL is cleaned, so a reload does not offer a second copy.
    expect(new URL(recipient.url()).searchParams.get('import')).toBeNull();
  } finally {
    await recipientContext.close();
  }
});
