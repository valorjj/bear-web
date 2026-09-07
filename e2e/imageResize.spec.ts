import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The drag, which jsdom cannot test: it implements neither `setPointerCapture`
 * nor a layout engine, so the width the grip reads would always be zero.
 * `storedImage.test.tsx` covers the keyboard route, which needs neither.
 */
async function pasteImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#cc6644';
    context.fillRect(0, 0, 800, 400);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/png'),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
}

/**
 * Waits until the resized width has actually reached IndexedDB.
 *
 * The DOM cannot be used for this, and the reason is the same one
 * `noteListHeader.spec.ts`'s `waitForSetting` docblock gives for settings:
 * autosave is debounced by `AUTOSAVE_DELAY_MS` (300ms) and the element's own
 * width is set live by the drag, so the editor reads as "resized" long before
 * the write has landed. `useFlushTriggers` listens to `beforeunload`, but that
 * can only START an asynchronous write — it cannot wait for one — so a
 * `page.reload()` fired inside the debounce window reloads a database that
 * never received the note. A human cannot drag and reload inside 300ms;
 * Playwright does it every time.
 *
 * This is what made this spec fail roughly two runs in three on an idle
 * machine, with two different symptoms depending on how much of the note had
 * landed: sometimes the width reverted to its pre-drag value, and sometimes
 * the note's own title never persisted at all, so the row this test clicks
 * after reloading did not exist. Both were one race, not two defects, and
 * neither was machine load.
 *
 * The condition is the ENCODED WIDTH rather than the note row appearing:
 * `formatImageAlt` writes the width into the image's alt as `![alt|388](...)`,
 * and every keystroke restarts the debounce, so a row bearing the right title
 * only proves some EARLIER save landed — not the one carrying the drag.
 */
async function waitForWidthSaved(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const request = indexedDB.open('bear-web');
              request.onerror = () => resolve(false);
              request.onsuccess = () => {
                const database = request.result;
                const all = database.transaction('notes').objectStore('notes').getAll();
                all.onsuccess = () => {
                  const rows = all.result as { text?: string }[];
                  resolve(rows.some((row) => /!\[[^\]]*\|\d+\]\(/.test(row.text ?? '')));
                  database.close();
                };
                all.onerror = () => {
                  resolve(false);
                  database.close();
                };
              };
            }),
        ),
      { message: 'the dragged width never reached IndexedDB' },
    )
    .toBe(true);
}

test('dragging the grip resizes the image, and the width survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Resizable');
  await page.keyboard.press('Enter');
  await pasteImage(page);

  const image = page.locator('.ProseMirror img.bear-stored-image');
  await expect(image).toHaveAttribute('src', /^blob:/);
  const before = (await image.boundingBox())!.width;

  // The grip is revealed by hovering the image, exactly as a user finds it.
  await image.hover();
  const grip = page.locator('.bear-image-grip');
  await expect(grip).toHaveCSS('opacity', '1');

  const gripBox = (await grip.boundingBox())!;
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x - 150, gripBox.y + gripBox.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = (await image.boundingBox())!.width;
  expect(after).toBeLessThan(before - 50);

  // THE assertion. A resize that only moved the element and never reached the
  // Markdown passes everything above and is lost the moment the note reopens.
  //
  // The wait is not padding and must not be replaced by a fixed timeout: it
  // polls for the width in IndexedDB, which is the only thing that
  // distinguishes "the drag reached the document" from "the drag moved a
  // DOM element". Reloading without it races the 300ms autosave debounce —
  // see `waitForWidthSaved`.
  await waitForWidthSaved(page);
  await editor.blur();
  await page.reload();
  await page.getByRole('button', { name: /Resizable/ }).click();

  const reopened = page.locator('.ProseMirror img.bear-stored-image');
  await expect(reopened).toHaveAttribute('src', /^blob:/);
  const restored = (await reopened.boundingBox())!.width;
  expect(Math.abs(restored - after)).toBeLessThan(8);
});
