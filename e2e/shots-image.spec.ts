import { expect, test } from '@playwright/test';

/**
 * A note with a real stored image, so the WebP quality and the column fit can
 * be JUDGED rather than argued. Nothing in the suite can see either.
 *
 * Tagged `@shots` so `playwright.config.ts`'s `grepInvert` keeps it out of
 * `npm run test:e2e`. Run with `npm run shots:image` and LOOK at the file.
 */
test.describe('@shots image', () => {
  test('a note with a pasted screenshot', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note' }).click();
    const editor = page.getByRole('textbox', { name: 'Note text' });
    await editor.click();
    await editor.pressSequentially('A note with a screenshot');
    await page.keyboard.press('Enter');

    await page.evaluate(async () => {
      // Text, at a realistic screenshot size, because softened text is the
      // failure mode WebP q80 would produce and a flat colour would hide.
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 500;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 1600, 500);
      context.fillStyle = '#202030';
      context.font = '28px monospace';
      for (let line = 0; line < 8; line += 1) {
        context.fillText(
          `const value${line} = compute({ id: ${line}, label: 'sharpness test' });`,
          32,
          60 + line * 52,
        );
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), 'image/png'),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob!], 'code.png', { type: 'image/png' }));
      document
        .querySelector('.ProseMirror')!
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
    });

    await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveAttribute(
      'src',
      /^blob:/,
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/design/shots/images/editor.png' });
  });
});
