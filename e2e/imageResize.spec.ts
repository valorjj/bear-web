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
  await editor.blur();
  await page.reload();
  await page.getByRole('button', { name: /Resizable/ }).click();

  const reopened = page.locator('.ProseMirror img.bear-stored-image');
  await expect(reopened).toHaveAttribute('src', /^blob:/);
  const restored = (await reopened.boundingBox())!.width;
  expect(Math.abs(restored - after)).toBeLessThan(8);
});
