import { expect, test } from '@playwright/test';

import { FIXED_NOW, type Corpus } from './fixtures/corpus.ts';
import {
  installFakeViewport,
  setKeyboardInset,
  setViewportOffset,
} from './fixtures/fakeViewport.ts';
import { seedDatabase } from './fixtures/seed.ts';

const PHONE = { width: 390, height: 844 };

/** Four columns, which is what squeezed to mid-word breaks before J3. */
const CORPUS: Corpus = {
  notes: [
    {
      id: 'j3',
      title: 'Phone editor',
      text: 'Phone editor\n\n## Section\n\nA paragraph.\n\n| column one | column two | column three | column four |\n| --- | --- | --- | --- |\n| alpha | beta | gamma | delta |\n\nTagged #work/urgent\n',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      /*
       * Long enough that the editor pane SCROLLS, which the note above is
       * deliberately not — and that difference is the whole reason the
       * toolbar's absolute position went unchecked from J3 until now. Every
       * assertion in this file measures the toolbar RELATIVELY (`before.y -
       * 336`), so all of them held while the bar itself sat 30px below the
       * bottom of the screen on any real note.
       */
      id: 'j3-long',
      title: 'Long enough to scroll',
      text:
        'Long enough to scroll\n\n' +
        Array.from(
          { length: 40 },
          (_unused, index) =>
            `Paragraph ${index + 1}. The editor pane has to overflow for this note to be worth ` +
            'anything, so there is a lot of it.',
        ).join('\n\n') +
        '\n',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
  ],
  settings: [],
};

async function openLongNote(page: import('@playwright/test').Page): Promise<void> {
  await installFakeViewport(page);
  await seedDatabase(page, CORPUS);
  await page.goto('/');
  await page.getByRole('button', { name: /Long enough to scroll/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
}

async function openNote(page: import('@playwright/test').Page): Promise<void> {
  await installFakeViewport(page);
  await seedDatabase(page, CORPUS);
  await page.goto('/');
  await page.getByRole('button', { name: /Phone editor/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeVisible();
}

const toolbar = (page: import('@playwright/test').Page) =>
  page.getByRole('toolbar', { name: 'Formatting toolbar' });

test.describe('the editor on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  /**
   * The bar is anchored to the VIEWPORT, not to the bottom of the scrolled
   * document — and the difference is invisible until a note is long enough to
   * scroll.
   *
   * Measured before the fix, on a 844px-tall screen: the toolbar's bottom edge
   * sat at **874**, leaving 14px of a 44px control strip reachable, and it
   * drifted further with every scroll. A short note hid it completely, because
   * then the content height and the pane height coincide and the two anchors
   * agree. Three of this file's own notes are short, which is why J3 shipped
   * green.
   *
   * Absolute, not relative: every other assertion here compares the toolbar
   * against its own earlier position, and all of them held throughout.
   */
  test('the toolbar stays on screen in a note long enough to scroll', async ({ page }) => {
    await openLongNote(page);

    const box = (await toolbar(page).boundingBox())!;
    expect(
      Math.round(box.y + box.height),
      "the toolbar's bottom edge is inside the 844px viewport",
    ).toBeLessThanOrEqual(PHONE.height);
  });

  test('the toolbar does not scroll away with the text', async ({ page }) => {
    await openLongNote(page);
    const before = (await toolbar(page).boundingBox())!;

    await page.getByRole('textbox', { name: 'Note text' }).evaluate((el) => {
      const scroller = el.closest('section');
      if (scroller !== null) scroller.scrollTop = 400;
    });
    await page.waitForTimeout(200);

    const after = (await toolbar(page).boundingBox())!;
    expect(Math.round(after.y), 'the toolbar held its place while the text scrolled').toBe(
      Math.round(before.y),
    );
  });

  test('the formatting toolbar rises clear of the keyboard', async ({ page }) => {
    await openNote(page);
    const before = (await toolbar(page).boundingBox())!;

    await setKeyboardInset(page, 336);
    await expect
      .poll(async () => Math.round((await toolbar(page).boundingBox())!.y))
      .toBe(Math.round(before.y) - 336);

    // The number matters, not merely that it moved: a toolbar that jumped by
    // some other amount is still under the keyboard or floating above it.
    const lifted = (await toolbar(page).boundingBox())!;
    expect(Math.round(lifted.y + lifted.height)).toBeLessThanOrEqual(844 - 336);
  });

  test('the toolbar returns when the keyboard closes', async ({ page }) => {
    await openNote(page);
    const before = (await toolbar(page).boundingBox())!;

    await setKeyboardInset(page, 336);
    await expect.poll(async () => (await toolbar(page).boundingBox())!.y).not.toBe(before.y);

    await setKeyboardInset(page, 0);
    await expect
      .poll(async () => Math.round((await toolbar(page).boundingBox())!.y))
      .toBe(Math.round(before.y));
  });

  test('the toolbar follows a visual-viewport scroll that changes no size', async ({ page }) => {
    // iOS lifts the page WITHIN the layout viewport to keep a focused field
    // above the keyboard, emitting `scroll` and no `resize`. A hook listening
    // to `resize` alone leaves the toolbar behind on exactly this motion, and
    // every other test in this file would still pass.
    await openNote(page);
    await setKeyboardInset(page, 336);
    const lifted = (await toolbar(page).boundingBox())!;

    await setViewportOffset(page, 60);
    await expect
      .poll(async () => Math.round((await toolbar(page).boundingBox())!.y))
      .toBe(Math.round(lifted.y) + 60);
  });

  test('a toolbar button is 44px of real ink', async ({ page }) => {
    await openNote(page);
    const bold = toolbar(page).getByRole('button', { name: 'Bold' });
    const box = (await bold.boundingBox())!;

    // The INK, not a pseudo-element. J2 could only expand a hit area here and
    // could not even do that, because `overflow-x-auto` clipped it.
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  });

  test('the toolbar still fits the screen and still scrolls', async ({ page }) => {
    await openNote(page);
    const box = (await toolbar(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    // Growing every button to 44px must not have turned a scrolling strip into
    // one that silently hides its overflow.
    const scroll = await toolbar(page).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  });

  test('the toolbar does not cover the prose it reserved space for', async ({ page }) => {
    // The phone sibling of `appearance.spec.ts`'s reserve assertion, which runs
    // at 1280 with no touch and therefore cannot see the grown strip.
    //
    // REWRITTEN in sub-project P, because the previous shape could not see the
    // defect it was named for. It read `.ProseMirror`'s `padding-bottom` (96px,
    // `RichEditor`'s then-`pb-24`, since removed as measured-inert) and
    // compared it against the pill's reach (68px here), and passed — while a
    // scrolled note's last line sat squarely behind the pill.
    // `.ProseMirror` is `min-h-0 flex-1` in a column flex container,
    // so its box is exactly the scroll container's height however long the note
    // is; its padding therefore sits at the bottom of that box, which on a
    // scrolled note is nowhere near the end of the content. The reserve is now
    // a `::after` BLOCK driven by `--bear-editor-pad-bottom` (`editor.css`),
    // and this asserts the geometry a user can see.
    //
    // This is the ONLY test that can see the coarse-pointer half of that
    // token, and that is why the token has a second value where `RichEditor`'s
    // abandoned `coarse:pb-32` had nothing to falsify it: deleting the
    // `@media (pointer: coarse)` block in `tokens.css` must fail HERE, and
    // does — 84px drops to 64px, under the 68px reach.
    await openNote(page);

    const reserve = await page
      .locator('.ProseMirror')
      .first()
      .evaluate((el) => Number.parseFloat(getComputedStyle(el, '::after').height));

    const pane = (await page.getByRole('region', { name: 'Editor' }).boundingBox())!;
    const box = (await toolbar(page).boundingBox())!;
    const reach = pane.y + pane.height - box.y;

    // The pill is `h-14` under `(pointer: coarse)`, inset `bottom-3`, so the
    // reach here is 68 against the desktop's 48 — which is the whole reason
    // this token has a second value at all.
    expect(reach, 'the toolbar is not the taller coarse-pointer pill').toBeGreaterThan(60);
    expect(reserve, `reserve ${reserve} vs reach ${reach}`).toBeGreaterThanOrEqual(reach);

    // …and the reserve genuinely lands at the end of the content. Type past the
    // bottom of the pane, scroll to the end, and compare the two boxes: this is
    // the assertion the padding-value comparison above it could never make.
    const editor = page.getByRole('textbox', { name: 'Note text' });
    await editor.click();
    for (let index = 0; index < 40; index += 1) {
      await editor.pressSequentially(`line ${index} of a long note`);
      await page.keyboard.press('Enter');
    }
    await editor.pressSequentially('LAST LINE');

    await page
      .locator('.ProseMirror')
      .first()
      .evaluate((element) => {
        const scroller = element.parentElement!;
        scroller.scrollTop = scroller.scrollHeight;
      });

    const last = page.locator('.ProseMirror > *', { hasText: 'LAST LINE' }).last();
    const lastBox = (await last.boundingBox())!;
    const barBox = (await toolbar(page).boundingBox())!;
    expect(
      lastBox.y + lastBox.height,
      `last line bottom ${lastBox.y + lastBox.height} vs toolbar top ${barBox.y}`,
    ).toBeLessThanOrEqual(barBox.y);
  });

  test('a wide table scrolls instead of squeezing', async ({ page }) => {
    await openNote(page);
    const wrapper = page.locator('.ProseMirror .tableWrapper');

    const measured = await wrapper.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      firstCell: Math.round(el.querySelector('th')!.getBoundingClientRect().width),
    }));

    expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth);
    // 8rem is the floor. Before J3 this measured 67px and rendered `colum` /
    // `n one`, breaking the word mid-character.
    expect(measured.firstCell).toBeGreaterThanOrEqual(128);
  });

  test('a scrolled table keeps its handles on their columns', async ({ page }) => {
    await openNote(page);

    // The handles exist only while the caret is inside the table, so arrow in
    // from the paragraph above — a click would leave a hover state and a tap
    // leaves a STICKY one, both of which confuse a visibility assertion
    // (`docs/rulings/testing-and-tooling.md`).
    // Deliberately a ONE-LINE paragraph. At 390px a longer one wraps, and the
    // single `ArrowDown` below then moves to its second line instead of into
    // the table — which presents as "no handles exist" rather than as a caret
    // in the wrong place.
    const paragraph = page.locator('.ProseMirror p', { hasText: 'A paragraph.' });
    const box = (await paragraph.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('ArrowDown');

    await expect(page.locator('[data-table-handle="column"]').first()).toHaveCount(1);

    /*
     * Scrolled and measured in ONE round trip, two frames later.
     *
     * The obvious form of this test — scroll, then `expect.poll` the two
     * centres — passes with the scroll listener deleted, and did. `poll`
     * retries for five seconds, and any unrelated view update in that window
     * re-measures the layer and hides the drift. What a user sees during a
     * fling is the frame right after the scroll, so that is what this reads.
     *
     * Two frames because `onScroll` coalesces through `requestAnimationFrame`:
     * one to schedule, one for the measure to have run.
     */
    const drift = await page.evaluate(async () => {
      const wrapper = document.querySelector('.ProseMirror .tableWrapper') as HTMLElement;
      wrapper.scrollLeft = 120;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

      const handle = document.querySelector('[data-table-handle="column"]') as HTMLElement;
      const cell = document.querySelector('.ProseMirror th') as HTMLElement;
      const h = handle.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      return Math.abs(h.left + h.width / 2 - (c.left + c.width / 2));
    });

    // Without the wrapper's scroll listener this measures ~120 — the handle
    // left behind over the prose while its column moved away underneath.
    expect(drift).toBeLessThan(4);
  });

  test('tapping a tag pill shows the filtered list', async ({ page }) => {
    await openNote(page);

    const pill = page.locator('.bear-tag', { hasText: 'work/urgent' });
    await expect(pill).toBeVisible();
    const box = (await pill.boundingBox())!;

    // `page.touchscreen.tap` is what the scrolled-table test above already
    // uses to place a real caret via a real touch gesture — the browser's
    // own compatibility mouse events are what `TagPill.ts`'s
    // `handleDOMEvents.mousedown` actually sees. `S4`'s design spec (decision
    // 6) is explicit that a phone tap and a desktop click share one gesture
    // rather than diverging, so the same `mousedown` interception this file's
    // other tests exercise indirectly applies here too.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    // `phoneScreen` is DERIVED from `selectedNoteId`
    // (`AppShell.handleActivateTag` calls `select(null)` on `mode ===
    // 'phone'`), so landing on the list means the editor pane is gone and the
    // note-list region has taken its place.
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);

    // And it is SCOPED to the tapped tag, not merely "some list appeared" —
    // the scope header's visible text and accessible name both name the tag.
    const scopeButton = page.getByRole('button', { name: 'List options: work/urgent' });
    await expect(scopeButton).toBeVisible();
    await expect(scopeButton).toHaveText('work/urgent');
    await expect(page.getByRole('button', { name: /Phone editor/ })).toBeVisible();
  });
});
