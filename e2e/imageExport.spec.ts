import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function pasteImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#227755';
    context.fillRect(0, 0, 120, 60);

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

async function noteWithImage(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially(title);
  await page.keyboard.press('Enter');
  await pasteImage(page);
  await expect(page.locator('.ProseMirror img.bear-stored-image')).toHaveAttribute('src', /^blob:/);
}

test('a Markdown export is a bundle a REAL unzipper can open', async ({ page }) => {
  // The whole point of this test. `src/lib/zip.test.ts` reads the archive back
  // with our own parser, which proves only that the reader and the writer
  // share whatever misunderstanding they have. `unzip` is a third party.
  await noteWithImage(page, 'Bundled note');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export note' }).click();
  await page.getByRole('menuitem', { name: 'Markdown' }).click();

  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);

  const dir = await mkdtemp(join(tmpdir(), 'bear-bundle-'));
  try {
    const path = join(dir, 'bundle.zip');
    await file.saveAs(path);

    // `unzip -t` verifies every entry's CRC. A wrong checksum produces a
    // perfectly-shaped archive that reports itself as corrupt, and this is the
    // only assertion in the repo that would notice.
    const verified = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    expect(verified).toContain('No errors detected');

    const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
    expect(listing).toMatch(/Bundled note\.md/);
    expect(listing).toMatch(/files\/[A-Za-z0-9_-]+\.webp/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an HTML export carries the image inside the file', async ({ page }) => {
  await noteWithImage(page, 'Inlined note');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export note' }).click();
  await page.getByRole('menuitem', { name: 'HTML' }).click();

  const file = await download;
  const dir = await mkdtemp(join(tmpdir(), 'bear-html-'));
  try {
    const path = join(dir, 'note.html');
    await file.saveAs(path);

    const html = execFileSync('cat', [path], { encoding: 'utf8' });
    expect(html).toContain('data:image/webp;base64,');
    // The relative path must be gone: an exported file that still points at
    // `files/…` is broken everywhere it is opened.
    expect(html).not.toMatch(/src="files\//);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
