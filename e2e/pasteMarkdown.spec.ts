import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A paste carrying real clipboard flavours.
 *
 * The ONLY place in the suite where a genuine two-flavour clipboard exists:
 * jsdom has no `DataTransfer` and no `ClipboardEvent` that accepts one, so the
 * unit tests hand-build a payload and cannot prove which flavour the handler
 * chose. A real browser can.
 */
async function paste(page: Page, flavours: { plain: string; html?: string }): Promise<void> {
  await page.evaluate((payload) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', payload.plain);
    if (payload.html !== undefined) transfer.setData('text/html', payload.html);
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, flavours);
}

async function newNote(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
}

test.describe('pasting Markdown', () => {
  test('a plain flavour beats an HTML flavour built only from wrappers', async ({ page }) => {
    await newNote(page);

    // Decision 2 AS REVERSED on 2026-09-03. This HTML declares no structure
    // at all — two `<p>`s around text that is itself Markdown, plus the
    // `&nbsp;` noise that made the original paste unusable. There is nothing
    // in it the plain flavour has lost, so the Markdown reading wins and the
    // heading and table are real nodes.
    //
    // This test used to be titled "a Markdown-shaped plain flavour beats the
    // HTML flavour" and asserted the OLD rule — plain wins whenever it LOOKS
    // like Markdown. The assertions survived the reversal unchanged because
    // this payload satisfies both rules; only the reason changed, and the
    // title said the wrong one.
    await paste(page, {
      plain: '## Weekly report\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
      html: '<p>##&nbsp;Weekly report</p><p>| a | b |</p>',
    });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.getByRole('heading', { level: 2 })).toHaveText('Weekly report');
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('table td')).toHaveCount(2);
    // The `&nbsp;` from the HTML flavour must be nowhere in the note.
    await expect(editor).not.toContainText('nbsp');
  });

  test('an HTML flavour that declares structure beats the plain flavour', async ({ page }) => {
    await newNote(page);

    // THE REVERSAL, and the only place a real two-flavour clipboard can prove
    // it — jsdom has no `DataTransfer`, so the unit tests can only ask the
    // handler whether it claimed the event, never which flavour landed.
    //
    // The plain flavour here is the lossy serialisation a rich source offers
    // alongside its HTML: the heading has become a fenced line and the table
    // an ASCII approximation, and a fence in a plain flavour is exactly what
    // mangled the reported Gemini paste. The HTML says `h2` and `table`, so
    // that is what the note gets — through ProseMirror's own HTML path, with
    // this plugin standing aside.
    await paste(page, {
      plain: '```markdown\n## Weekly report\n\n+---+---+\n| a | b |\n+---+---+\n```',
      html: '<h2>Weekly report</h2><table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.getByRole('heading', { level: 2 })).toHaveText('Weekly report');
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('table td')).toHaveCount(2);
    // The tell that the plain flavour was NOT re-parsed: its outer fence
    // would have made a code block, and the fence is what broke the reported
    // paste.
    await expect(editor.locator('pre')).toHaveCount(0);
    await expect(editor).not.toContainText('markdown');
  });

  test('a prose plain flavour leaves the HTML flavour to ProseMirror, keeping the link', async ({
    page,
  }) => {
    await newNote(page);

    // Copying a paragraph off a web page. The plain flavour carries no
    // structure, so parsing it would THROW AWAY the link the HTML flavour
    // has. This is the regression decision 2 exists to prevent.
    await paste(page, {
      plain: 'Read the announcement for details.',
      html: '<p>Read <a href="https://example.com">the announcement</a> for details.</p>',
    });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.getByRole('link', { name: 'the announcement' })).toBeVisible();
  });

  test('a plain-only clipboard is always parsed, with no HTML flavour to weigh', async ({
    page,
  }) => {
    await newNote(page);

    // No `text/html` at all — a terminal, a plain editor, a .md file. Decision
    // 1: parsed unconditionally, no detector consulted.
    await paste(page, { plain: '- one\n- two\n- three' });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor.locator('ul li')).toHaveCount(3);
  });

  test('entities the Markdown parser leaves literal are decoded', async ({ page }) => {
    await newNote(page);

    await paste(page, { plain: '## Caf&eacute; &mdash; 2026&nbsp;report' });

    const editor = page.getByRole('textbox', { name: 'Note text' });
    const heading = editor.getByRole('heading', { level: 2 });
    await expect(heading).toContainText('Café');
    await expect(heading).toContainText('—');
    await expect(heading).not.toContainText('&');
  });
});
