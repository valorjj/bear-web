import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * B2's drag gesture. jsdom implements no `setPointerCapture` and no layout
 * engine, so the geometric core of the drag — which boundary a pointer
 * chooses, whether the pointer capture survives leaving the badge, auto-scroll,
 * the indicator's real appearance, and the touch refusal — is exercised by
 * `HeadingFold.test.ts` but never *judged* there. This file is the only
 * harness that can.
 *
 * All tests use the corpus's `SCROLL_NOTE` ("A note long enough to scroll"):
 * 40 uniquely-titled, same-level (`## Section N`) sections, already shaped for
 * this by `e2e/fixtures/corpus.ts` — not modified here, per the controller's
 * instruction to reuse it rather than grow a new fixture.
 */

const SCROLL_NOTE_TITLE = /A note long enough to scroll/;

/** Opens the scroll note and waits for its 40 sections to be in the DOM. */
async function openScrollNote(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: SCROLL_NOTE_TITLE }).click();
  await expect(page.getByRole('region', { name: 'Editor' })).toBeVisible();
  const headings = page.locator('.ProseMirror h2');
  await expect(headings).toHaveCount(40);
  return headings;
}

/** The level badge for a given heading, made visible the way a real user sees it. */
async function badgeOf(heading: Locator): Promise<Locator> {
  await heading.hover();
  return heading.locator('[data-fold-badge]');
}

/**
 * Drags a section's badge to a drop boundary, exactly as a user would: press,
 * travel well past the 4px threshold (and well outside the badge itself, so
 * the test exercises pointer capture rather than only ever firing events
 * while still over the source element), then approach the target.
 */
async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const badge = await badgeOf(source);
  const from = (await badge.boundingBox())!;
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the threshold, and well outside the badge's own tiny hit area.
  await page.mouse.move(from.x + from.width / 2, from.y + 30);
  await page.mouse.move(to.x + to.width / 2, to.y - 2, { steps: 10 });
  await expect(page.locator('.bear-section-drop')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.bear-section-drop')).toHaveCount(0);
}

test.describe('drag-to-reorder headings', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
  });

  test('dragging a badge upward moves the section and its body', async ({ page }) => {
    const headings = await openScrollNote(page);
    const before = await headings.allInnerTexts();

    await dragTo(page, headings.nth(2), headings.nth(0));

    // A value that CHANGES with the behaviour: the specific expected order,
    // not merely "differs from before" (docs/rulings/testing-and-tooling.md).
    await expect(headings).toHaveText([before[2], before[0], before[1], ...before.slice(3)]);

    // "and its body": the paragraph that belonged to the moved section must
    // have travelled with it, immediately following its heading in the new
    // position — not merely the heading text reordered on its own.
    const firstHeading = page.locator('.ProseMirror h2').first();
    const followingParagraph = firstHeading.locator('xpath=following-sibling::p[1]');
    await expect(followingParagraph).toContainText('Paragraph 3.');
  });

  test('a drag places no caret and starts no text selection', async ({ page }) => {
    const headings = await openScrollNote(page);

    // A distinctive caret position, set deliberately far from where the drag
    // itself happens, so "unchanged" is a meaningful claim rather than a
    // coincidence of both being empty.
    const anchorParagraph = page.locator('.ProseMirror p', { hasText: 'Paragraph 20.' });
    await anchorParagraph.click();
    const before = await page.evaluate(() => {
      const sel = window.getSelection();
      const node = sel?.anchorNode ?? null;
      const el = node instanceof Element ? node : node?.parentElement;
      return {
        text: sel?.toString() ?? '',
        anchorNodeText: node?.textContent ?? null,
        anchorOffset: sel?.anchorOffset ?? null,
        paragraphText: el?.closest('p')?.textContent ?? null,
      };
    });
    // The paragraph the caret actually landed in — the split by the inline
    // code mark means `anchorNode` itself is only ONE of several text nodes
    // in that paragraph, so its own text is not this substring; the enclosing
    // `<p>` is what proves the caret is where the test intends.
    expect(before.paragraphText).toContain('Paragraph 20.');

    const badge = await badgeOf(headings.nth(2));
    const from = (await badge.boundingBox())!;
    const to = (await headings.nth(0).boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + 30);
    // Travel across several headings' worth of text — exactly the gesture a
    // native browser text-drag would turn into a selection.
    await page.mouse.move(to.x + to.width / 2, to.y - 2, { steps: 10 });

    const during = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(during).toBe('');

    await page.mouse.up();

    const after = await page.evaluate(() => {
      const sel = window.getSelection();
      const node = sel?.anchorNode ?? null;
      const el = node instanceof Element ? node : node?.parentElement;
      return {
        text: sel?.toString() ?? '',
        anchorNodeText: node?.textContent ?? null,
        anchorOffset: sel?.anchorOffset ?? null,
        paragraphText: el?.closest('p')?.textContent ?? null,
      };
    });
    // The caret is EXACTLY where it was — not merely "still collapsed" but
    // anchored to the same text node and offset, despite the drag happening
    // entirely elsewhere in the document.
    expect(after).toEqual(before);
  });

  test('Escape mid-drag leaves the document untouched', async ({ page }) => {
    const headings = await openScrollNote(page);
    const before = await headings.allInnerTexts();

    // Escape is handled by the editor's own `handleKeyDown`, which only ever
    // sees keydowns dispatched to the editable DOM node — and the badge's
    // `pointerdown` calls `preventDefault()` unconditionally, which (per the
    // Pointer Events spec) suppresses the compatibility `mousedown`/`click`
    // the browser would otherwise use to move focus there. A real user's
    // caret is already in the document before they reach for the gutter;
    // this focuses the editor the same way, away from the section a drag
    // is about to touch.
    await page.locator('.ProseMirror p', { hasText: 'Paragraph 10.' }).click();

    const badge = await badgeOf(headings.nth(2));
    const from = (await badge.boundingBox())!;
    const to = (await headings.nth(0).boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + 30);
    await page.mouse.move(to.x + to.width / 2, to.y - 2, { steps: 10 });
    await expect(page.locator('.bear-section-drop')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.bear-section-drop')).toHaveCount(0);
    await expect(page.locator('.bear-section-dragging')).toHaveCount(0);
    await expect(headings).toHaveText(before);

    // Release the still-down button so the gesture doesn't leak into whatever
    // Playwright does next; the handler is a no-op since Escape already
    // cleared the press.
    await page.mouse.up();
    await expect(headings).toHaveText(before);
  });

  test('a folded section moves with its hidden body and stays folded', async ({ page }) => {
    const headings = await openScrollNote(page);
    const before = await headings.allInnerTexts();

    // Fold the third section before dragging it.
    const source = headings.nth(2);
    await source.hover();
    const toggle = source.locator('[data-fold-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const hiddenParagraph = page.locator('.ProseMirror p', { hasText: 'Paragraph 3.' });
    await expect(hiddenParagraph).toHaveCSS('display', 'none');

    await dragTo(page, source, headings.nth(0));

    // The moved heading's own text now carries the folded marker ("…") the
    // fold decoration appends, since it is still folded at its new position.
    await expect(headings).toHaveText([`${before[2]}…`, before[0], before[1], ...before.slice(3)]);

    // Still folded at its new position — the fold key survived the reorder.
    const movedHeading = page.locator('.ProseMirror h2').first();
    await expect(movedHeading.locator('[data-fold-toggle]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Its body moved WITH it (still present, still hidden, still immediately
    // following the moved heading) rather than being dropped or left behind.
    await expect(hiddenParagraph).toHaveCount(1);
    await expect(hiddenParagraph).toHaveCSS('display', 'none');
    const precedesMovedHeading = await hiddenParagraph.evaluate(
      (el) => el.previousElementSibling?.tagName,
    );
    expect(precedesMovedHeading).toBe('H2');
  });

  test('a drag near the pane edge scrolls the editor, and drops at the post-scroll position', async ({
    page,
  }) => {
    const headings = await openScrollNote(page);
    const before = await headings.allInnerTexts();

    const pane = (await page.getByRole('region', { name: 'Editor' }).boundingBox())!;
    const scroller = page.locator('.ProseMirror').locator('xpath=..');
    const initialScrollTop = await scroller.evaluate((el) => el.scrollTop);
    expect(initialScrollTop).toBe(0);

    // The target must genuinely be off-screen at the start, or the auto-scroll
    // this test exists to exercise never actually has to run.
    const targetIndex = 19; // "Section 20"
    const targetBefore = (await headings.nth(targetIndex).boundingBox())!;
    expect(targetBefore.y).toBeGreaterThan(pane.y + pane.height);

    const badge = await badgeOf(headings.nth(1)); // "Section 2"
    const from = (await badge.boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Past the threshold, then parked within `AUTO_SCROLL_EDGE` (40px) of the
    // pane's bottom edge — the auto-scroll loop runs on its own `rAF` ticks
    // from here, without further pointer events.
    await page.mouse.move(from.x + from.width / 2, from.y + 30);
    await page.mouse.move(from.x + from.width / 2, pane.y + pane.height - 5);

    await expect
      .poll(
        async () => {
          const box = await headings.nth(targetIndex).boundingBox();
          return box !== null && box.y >= pane.y && box.y <= pane.y + pane.height;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const scrolledTop = await scroller.evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(initialScrollTop);

    // Now approach the target at its POST-SCROLL position. This is the
    // assertion that matters: document-scroll coordinates exist so that a
    // pointer parked at a fixed viewport position, over a document that has
    // moved underneath it, still measures against the boundary it is really
    // pointing at.
    const targetAfter = (await headings.nth(targetIndex).boundingBox())!;
    await page.mouse.move(targetAfter.x + targetAfter.width / 2, targetAfter.y - 2, {
      steps: 5,
    });
    await expect(page.locator('.bear-section-drop')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.bear-section-drop')).toHaveCount(0);

    // The expected order is derived from the same "insert immediately before
    // the target" rule `planSectionMove` implements — a specific, computed
    // array, not a bare "it changed" check.
    const expected = [...before];
    const moved = expected.splice(1, 1)[0];
    const insertAt = expected.indexOf(before[targetIndex]);
    expected.splice(insertAt, 0, moved);

    await expect(headings).toHaveText(expected);
  });

  test('the context menu moves a section by keyboard alone', async ({ page }) => {
    const headings = await openScrollNote(page);
    const before = await headings.allInnerTexts();

    // Section 5 (index 4): neither first nor last, so both directions are
    // enabled. Caret placed by a real click, which real layout supports —
    // unlike jsdom, which has no hit testing at all.
    const paragraph = page.locator('.ProseMirror p', { hasText: 'Paragraph 5.' });
    await paragraph.click();

    // `useEditorState`'s subscription re-renders `EditorContextMenu`'s host
    // asynchronously relative to the click's native selection change; opening
    // the menu one animation frame too early reads the PREVIOUS render's
    // flags, in which `section` is still false and the whole group is absent.
    // Two frames — one for the click's transaction to flush, one for the
    // resulting re-render to commit — settles this deterministically.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Editing options' });
    await expect(menu).toBeVisible();

    // This is the keyboard-only route: no arrow-key menu navigation exists
    // here (`useAnchoredMenu` provides a Tab trap, not roving arrows), so the
    // real user gesture is repeated Tab.
    const target = 'Move section down';
    let found = false;
    for (let i = 0; i < 40 && !found; i += 1) {
      const active = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      if (active === target) {
        found = true;
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(found).toBe(true);

    await page.keyboard.press('Enter');

    // Section 5 hops over Section 6 — a swap of exactly those two, and
    // nothing else, in document order.
    const expected = [...before];
    [expected[4], expected[5]] = [expected[5], expected[4]];
    await expect(headings).toHaveText(expected);
  });
});

test.describe('on a touch device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('tapping the badge opens the menu and never drags', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await page.getByRole('button', { name: SCROLL_NOTE_TITLE }).click();

    const editor = page.getByRole('textbox', { name: 'Note text' });
    await expect(editor).toBeVisible();

    const heading = page.locator('.ProseMirror h2').first();
    const badge = heading.locator('[data-fold-badge]');
    const box = (await badge.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // A tap opens the level menu and never leaves a drop indicator behind.
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole('menu', { name: 'Heading level' })).toBeVisible();
    await expect(page.locator('.bear-section-drop')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Heading level' })).toBeHidden();

    // A slide from the same badge must scroll the note rather than start a
    // drag — the state machine's own unit test proves it ignores
    // `pointerType: 'touch'`; only real touch input can prove the note is
    // still scrollable from the gutter as a result.
    const scroller = page.locator('.ProseMirror').locator('xpath=..');
    const beforeScroll = await scroller.evaluate((el) => el.scrollTop);

    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - 150 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - 300 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();

    await expect(page.locator('.bear-section-drop')).toHaveCount(0);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(beforeScroll);

    // No reordering happened either.
    await expect(page.locator('.ProseMirror h2').first()).toHaveText(/Section 1$/);
  });
});
