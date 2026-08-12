import { expect, test } from '@playwright/test';

/*
 * Appearance regressions — the class of defect this project's unit suite
 * cannot see, by construction.
 *
 * Three separate bugs shipped through a fully green suite of 700+ tests:
 *
 *   1. `--color-hover` was never added to the `@theme` block, so every
 *      `hover:bg-hover` in both editor toolbars compiled to nothing. Tailwind
 *      v4 emits no warning for a utility whose theme key is absent. Two
 *      milestones of buttons with no hover state.
 *   2. `Button`'s `default` variant had neither border nor fill, so "New
 *      note", "Delete" and "Restore" were indistinguishable from static text.
 *   3. The editor had no prose CSS whatsoever. Headings rendered at 14px/400,
 *      lists had no markers and no indent, blockquotes had no border, and a
 *      task item stacked its checkbox above its text — which reads as the
 *      editor force-wrapping every todo onto a new line.
 *
 * In all three the document model was correct and every structural assertion
 * passed. The round-trip suite drives `MarkdownManager` with no DOM at all,
 * and the component tests assert document structure rather than computed
 * style, so nothing in the project could observe "renders wrong".
 *
 * These tests read `getComputedStyle` and real bounding boxes out of a real
 * browser. That is the only place the question can be asked.
 *
 * Deliberately relative, not pinned: `e2e/smoke.spec.ts` pins the palette
 * because a token change there should demand a conscious edit. Here the
 * absolute numbers are M8's to change — the typography sliders move every
 * font size by design. What must never regress is the *relationship*: a
 * heading is bigger than body text, a list is indented, a checkbox sits
 * beside its label.
 */

/** Every construct below in one note, so one editor mount covers them all. */
async function openNoteWithProse(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();

  // Typed, never filled: `# `, `- ` and `> ` are Tiptap input rules and
  // `fill` bypasses input rules entirely, which would leave literal text and
  // no structure at all — every assertion below would then be measuring a
  // plain paragraph.
  await editor.pressSequentially('# Heading');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('Body paragraph');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('- bullet item');
  // Twice: the first Enter opens a second list item, the second lifts out of
  // the list so the blockquote is a sibling rather than nested inside it.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('> quoted line');

  await expect(page.getByRole('heading', { name: 'Heading' })).toBeVisible();
  return editor;
}

test('a default button reads as a control at rest, not as text', async ({ page }) => {
  await page.goto('/');

  const created = page.getByRole('button', { name: 'New note' });
  await expect(created).toBeVisible();

  const style = await created.evaluate((element) => {
    const own = getComputedStyle(element);
    const pane = element.closest('[role="region"]');
    return {
      borderWidth: own.borderTopWidth,
      background: own.backgroundColor,
      paneBackground: pane === null ? null : getComputedStyle(pane).backgroundColor,
    };
  });

  // The two independent affordances the M6 defect removed. Either alone would
  // be enough to see the control; asserting both means restoring only one does
  // not quietly re-pass.
  expect(style.borderWidth).not.toBe('0px');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');

  // A fill identical to the pane behind it is not a fill. This is what makes
  // the assertion above more than a tautology.
  expect(style.background).not.toBe(style.paneBackground);
});

test('hover states are compiled, not silently dropped by a missing theme key', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  // Both toolbars, because the missing theme key silenced `hover:bg-hover` in
  // both of them and a fix that reached only one would still be a defect.
  for (const toolbar of ['Top controls', 'Formatting toolbar']) {
    const bold = page.getByRole('toolbar', { name: toolbar }).getByRole('button', { name: 'Bold' });
    await expect(bold).toBeVisible();

    const readBackground = () =>
      bold.evaluate((element) => getComputedStyle(element).backgroundColor);

    // At rest this button carries no background class at all, which is the
    // baseline the hover has to move away from.
    const atRest = await readBackground();
    expect(atRest, toolbar).toBe('rgba(0, 0, 0, 0)');

    await bold.hover();

    // Polled, not read once: the background is transitioned over
    // `--bear-duration-fast`, so a single read can land mid-transition or
    // before it starts.
    await expect.poll(readBackground).not.toBe(atRest);

    // Move off, so the next iteration's at-rest read is not this button's
    // lingering hover.
    await page.mouse.move(0, 0);
  }
});

test('the editor renders Markdown constructs as visually distinct structure', async ({ page }) => {
  const editor = await openNoteWithProse(page);

  const measured = await editor.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(`.ProseMirror ${selector}`);
      if (element === null) return null;
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10),
        listStyleType: style.listStyleType,
        paddingLeft: Number.parseFloat(style.paddingLeft),
        borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
      };
    };
    return {
      heading: read('h1'),
      paragraph: read('p'),
      list: read('ul'),
      quote: read('blockquote'),
    };
  });

  const { heading, paragraph, list, quote } = measured;
  if (heading === null || paragraph === null || list === null || quote === null) {
    throw new Error(`a construct never rendered: ${JSON.stringify(measured)}`);
  }

  // A heading that is body-sized and body-weight is what the missing prose
  // stylesheet actually produced: h1 at 14px/400, identical to a paragraph.
  expect(heading.fontSize).toBeGreaterThan(paragraph.fontSize);
  expect(heading.fontWeight).toBeGreaterThan(paragraph.fontWeight);

  // Preflight strips both of these. A list with no marker and no indent is
  // indistinguishable from consecutive paragraphs.
  expect(list.listStyleType).not.toBe('none');
  expect(list.paddingLeft).toBeGreaterThan(0);

  // The quote's only visual signal.
  expect(quote.borderLeftWidth).toBeGreaterThan(0);
});

test('a task item puts its checkbox beside its text, not above it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();

  // No leading `- `: TaskItem's own input rule fires on `[ ] ` alone, whereas
  // typing `- ` first hands the line to StarterKit's bulletList rule and no
  // task item ever forms. (That collision is M7's first item.)
  await editor.pressSequentially('[ ] milk');
  await expect(editor.getByRole('checkbox')).toBeVisible();

  const layout = await editor.evaluate(() => {
    const item = document.querySelector('.ProseMirror ul[data-type="taskList"] li');
    const box = item?.querySelector('input[type="checkbox"]');
    const content = item?.querySelector(':scope > div');
    if (!box || !content) return null;
    const b = box.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    return {
      boxRight: b.right,
      boxTop: b.top,
      boxBottom: b.bottom,
      contentLeft: c.left,
      contentTop: c.top,
      contentBottom: c.bottom,
    };
  });

  if (layout === null)
    throw new Error('the task item never rendered a checkbox and a content block');

  // Beside: the checkbox ends before the text begins. Without the flex rules
  // the content `div` is block-level and starts at the item's left edge, on
  // the line below — so it begins to the *left* of where the checkbox ends,
  // and this fails.
  expect(layout.boxRight).toBeLessThanOrEqual(layout.contentLeft + 1);

  // On the same line: their vertical extents overlap. Checked independently of
  // the horizontal test because a checkbox floated left of a paragraph two
  // lines down would satisfy that one alone.
  expect(layout.boxTop).toBeLessThan(layout.contentBottom);
  expect(layout.contentTop).toBeLessThan(layout.boxBottom);
});

test('the app renders in its own typeface, not the system fallback', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region')).toHaveCount(3);

  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain('Pretendard Variable');

  /*
   * Naming the family is not the same as having it. `tokens.css` named
   * 'Pretendard' with no `@font-face` anywhere for five milestones, and the
   * app silently ran on system-ui the whole time — a token string and a
   * loaded font are independent facts.
   *
   * `scripts/fonts.test.ts` compares the token against the families the
   * shipped stylesheet declares, which is a source-level check. This is the
   * rendered-pixel half: measure the same string twice, once in the real
   * family and once in a family that cannot exist. Both fall back to the same
   * generic if the real font is absent, so identical widths mean the font
   * never loaded.
   */
  const widths = await page.evaluate(async () => {
    await document.fonts.ready;
    const measure = (fontFamily: string) => {
      const probe = document.createElement('span');
      probe.textContent = 'Handgloves 한글 0123456789';
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:64px;font-family:${fontFamily}`;
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    return {
      real: measure("'Pretendard Variable', sans-serif"),
      absent: measure("'NoSuchFamily-4d1a7f', sans-serif"),
    };
  });

  expect(widths.real).toBeGreaterThan(0);
  expect(widths.real).not.toBe(widths.absent);
});

test('the search field reads as a control at rest', async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('searchbox', { name: 'Search notes' });
  await expect(search).toBeVisible();

  const style = await search.evaluate((element) => {
    const own = getComputedStyle(element);
    const pane = element.closest('[role="region"]');
    return {
      borderWidth: own.borderTopWidth,
      background: own.backgroundColor,
      paneBackground: pane === null ? null : getComputedStyle(pane).backgroundColor,
    };
  });

  expect(style.borderWidth).not.toBe('0px');
  expect(style.background).not.toBe(style.paneBackground);
});
