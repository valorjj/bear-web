import { expect, test } from '@playwright/test';

/**
 * Task 5 of sub-project H: clicking into highlighted text pops the colour
 * palette anchored at that text, rather than requiring a trip to the bottom
 * toolbar. Covers only what no unit test can — real geometry and the
 * palette's real show/hide behaviour as the caret moves in and out of a mark.
 *
 * Task 10 adds the right-click (and `Shift-F10`) context menu below. It too
 * covers only what no unit test can: whether the BROWSER's own menu is
 * actually suppressed, real flip geometry near a viewport edge, and — the
 * one Task 6's own unit test had to fake with a `posAtCoords` spy because
 * jsdom has no hit testing — whether a table command actually lands on the
 * cell the pointer was over, not wherever the caret happened to already be.
 */

async function highlightWord(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('plain marked plain');
  await expect(editor).toContainText('plain marked plain');

  // Keyboard selection of the middle word, rather than a pointer double-click:
  // `getByText('marked')` resolves to the whole paragraph (its only text
  // node), so a click lands wherever Playwright centres THAT bounding box,
  // not on the word itself.
  //
  // A fresh `.click()` right before the keyboard sequence, not reused from
  // above: the seeded note remounts once it first acquires an id, and
  // `editorAffordances.spec.ts` documents that a keyboard sequence sent while
  // that remount is in flight silently lands on nothing — the same shape of
  // race, not a new one.
  const paragraph = page.locator('.ProseMirror > p').first();
  await paragraph.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 'plain '.length; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  for (let i = 0; i < 'marked'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('marked');

  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(1);
}

test('the highlight palette follows the caret into and out of a highlight', async ({ page }) => {
  await highlightWord(page);

  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  // The caret is still inside the mark right after applying it.
  await expect(palette).toBeVisible();

  // Click outside the mark. `plain marked plain` is one paragraph with a
  // single text run either side of the `<mark>`, so a plain `getByText`
  // click would centre on the whole paragraph — which sits ON the mark; a
  // position near the paragraph's own left edge unambiguously lands on the
  // leading "plain" instead.
  const paragraph = page.locator('.ProseMirror > p').first();
  await paragraph.click({ position: { x: 4, y: 6 } });
  await expect(palette).toBeHidden();

  // click back into the highlighted word — the mark is its own element, so
  // clicking it directly is unambiguous.
  const mark = page.locator('.ProseMirror mark');
  await mark.click();
  await expect(palette).toBeVisible();

  const markBox = await mark.boundingBox();
  const paletteBox = await palette.boundingBox();
  expect(markBox).not.toBeNull();
  expect(paletteBox).not.toBeNull();
  // Anchored above its own text, horizontally centred on it.
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(markBox!.y + 4);
});

test('choosing a colour recolours without moving the caret, and remove clears the mark', async ({
  page,
}) => {
  await highlightWord(page);

  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  await expect(palette).toBeVisible();

  await palette.getByRole('menuitemradio', { name: 'Green' }).click();
  await expect(page.locator('.ProseMirror mark.hl-green')).toHaveText('marked');
  // The palette stays up: the caret never left the mark.
  await expect(palette).toBeVisible();

  await palette.getByRole('button', { name: 'Remove highlight' }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toContainText(
    'plain marked plain',
  );
});

test('the palette flips below the highlight when there is no room above it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');

  // Enough padding above AND below the target line that the mark can be
  // scrolled to sit in the very top band of the viewport with real content
  // on both sides — this is the case R8's screenshot review found broken:
  // the palette anchors ABOVE by default, and a highlight scrolled into the
  // top band leaves it with no room there at all.
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.type(`Padding line ${i} above the highlight.`);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('plain marked plain');
  await page.keyboard.press('Enter');
  // Well more than enough below that the pane's max scroll position is not
  // the limiting factor — with only as much content below as above, the
  // container was already scrolled to its ceiling once typing finished, and
  // no further scroll (in either direction) could move the mark at all.
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.type(`Padding line ${i} below the highlight.`);
    await page.keyboard.press('Enter');
  }

  // Typing 60 padding lines below auto-scrolled the pane to keep the caret
  // in view, so "marked" is off-screen (a raw `mouse.click` at its real
  // coordinates would land outside the window and select nothing). Scroll it
  // into view before locating it.
  await page
    .locator('.ProseMirror > p', { hasText: 'plain marked plain' })
    .scrollIntoViewIfNeeded();

  // Locate "marked" by its own text node/`Range` and click there directly,
  // rather than walking character counts from `Home` after a paragraph
  // click: with 15 padding lines above it, the target line is off-screen
  // until the click auto-scrolls it into view, and the caret can land in the
  // wrong paragraph if that scroll is still settling when `Home` fires.
  const wordRect = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector('.ProseMirror')!,
      NodeFilter.SHOW_TEXT,
    );
    let node: Text | null;
    // eslint-disable-next-line no-cond-assign
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.indexOf('marked') ?? -1;
      if (idx !== -1 && node.textContent === 'plain marked plain') {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'marked'.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  });
  expect(wordRect).not.toBeNull();
  await page.mouse.click(wordRect!.x + wordRect!.width / 2, wordRect!.y + wordRect!.height / 2, {
    clickCount: 2,
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('marked');

  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.locator('.ProseMirror mark')).toHaveCount(1);

  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  await expect(palette).toBeVisible();

  // Scroll the pane until the mark sits 10px from the top of the viewport —
  // the band where an above-anchored palette has no room and must flip
  // below instead. The scrollable element is the `overflow-auto` wrapper
  // `EditorContent` renders, not `.ProseMirror` itself.
  const scrollContainer = page.locator('.overflow-auto').first();
  await scrollContainer.evaluate((el, targetTop) => {
    const markEl = el.querySelector('mark');
    if (markEl === null) throw new Error('mark not found during scroll setup');
    el.scrollTop += markEl.getBoundingClientRect().top - targetTop;
    // A native scroll fires this asynchronously (typically batched to the
    // next frame): the DOM's own `scrollTop` reads back correctly right
    // away, but the app's `scroll`-listener-driven re-measurement has not
    // necessarily run yet, so a `boundingBox()` read immediately after can
    // observe the position from BEFORE this scroll. Dispatching the event
    // ourselves makes the capture listener on `window` run synchronously
    // (capture-phase listeners fire regardless of `bubbles`), so the
    // assertion below observes the settled result rather than racing it.
    el.dispatchEvent(new Event('scroll'));
  }, 10);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  // Fully within the viewport — not clipped off the top edge.
  const paletteBox = await palette.boundingBox();
  expect(paletteBox).not.toBeNull();
  expect(paletteBox!.y).toBeGreaterThanOrEqual(0);
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(viewport!.height);
});

// --- Task 10: the right-click context menu ---------------------------------

const CONTEXT_MENU = { name: 'Editing options' } as const;

async function openNoteWithText(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('some prose text');
  await expect(editor).toContainText('some prose text');
}

/** Same shape as `editorAffordances.spec.ts`'s own helper of the same name. */
async function openNoteWithTable(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await expect(editor).toContainText('Title');

  await page.keyboard.press('Enter');
  await page
    .getByRole('toolbar', { name: 'Formatting toolbar' })
    .getByRole('button', { name: 'Table' })
    .click();

  await expect(page.locator('.ProseMirror table')).toHaveCount(1);
}

test('right-click opens ours and suppresses the browser menu', async ({ page }) => {
  await openNoteWithText(page);

  // No native `contextmenu` API exists for Playwright to query — a real OS
  // context menu renders outside the page entirely. What IS observable from
  // inside the page is whether the event that would have opened it was
  // prevented, which is exactly what `ContextMenu.ts`'s handler does. Recorded
  // through a capture-phase listener installed BEFORE the click, since our own
  // plugin's listener runs first and installing after the click would race it.
  // BUBBLE phase, deliberately not capture: bubbling reaches `document` LAST,
  // after every ancestor's own listener (including the ProseMirror view's own
  // `contextmenu` handler on `.ProseMirror` itself) has already run — so by
  // the time this fires, `preventDefault()` has already happened if it was
  // going to.
  await page.evaluate(() => {
    (window as unknown as { __ctxPrevented: boolean | null }).__ctxPrevented = null;
    document.addEventListener('contextmenu', (event) => {
      (window as unknown as { __ctxPrevented: boolean | null }).__ctxPrevented =
        event.defaultPrevented;
    });
  });

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click({ button: 'right' });

  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __ctxPrevented: boolean | null }).__ctxPrevented),
    )
    .toBe(true);

  // Escape returns focus to the writing surface rather than leaving it on
  // whatever the menu's own first item focused. Checked as
  // `document.activeElement`, not by typing and re-reading the text: the
  // right-click landed wherever the pointer happened to resolve within the
  // editor, and this assertion should not depend on exactly where that was.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.classList.contains('ProseMirror')))
    .toBe(true);
});

test("the browser's own menu still appears over the sidebar", async ({ page }) => {
  await openNoteWithText(page);

  // The tag sidebar, unlike the editor, never registers the plugin — so its
  // `contextmenu` event must reach the browser untouched.
  const sidebar = page.getByRole('button', { name: 'New note' });
  const prevented = await sidebar.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        el.addEventListener('contextmenu', (event) => resolve(event.defaultPrevented), {
          once: true,
        });
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 5,
            clientY: 5,
          }),
        );
      }),
  );
  expect(prevented).toBe(false);
  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeHidden();
});

test('Shift+F10 opens the menu at the caret', async ({ page }) => {
  await openNoteWithText(page);

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.press('Shift+F10');

  const menu = page.getByRole('menu', CONTEXT_MENU);
  await expect(menu).toBeVisible();

  // Table section absent: the caret sits in plain prose.
  await expect(page.getByRole('group', { name: 'Table' })).toHaveCount(0);
});

test('the table section appears only inside a table', async ({ page }) => {
  await openNoteWithText(page);

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click({ button: 'right' });
  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Table' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeHidden();

  await openNoteWithTable(page);
  const cell = page.locator('.ProseMirror td').first();
  await cell.click({ button: 'right' });

  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Table' })).toBeVisible();
});

test('the menu flips above the pointer near the bottom edge', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');

  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.type(`Padding line ${i} filler text here.`);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('bottom target line');

  // No manual scroll needed, unlike the palette flip test above: a
  // contenteditable auto-scrolls to keep the caret in view as the user
  // types, and it does so minimally — verified directly, typing this many
  // lines already leaves the last one within about 10px of the WINDOW'S
  // bottom edge (not merely the pane's), which is exactly the band
  // `EditorContextMenu`'s own flip check (`window.innerHeight`) has no room
  // in.
  const target = page.locator('.ProseMirror > p', { hasText: 'bottom target line' });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();

  // Near the paragraph's own LEFT edge, not its horizontal centre: the
  // floating bottom toolbar is centred over the pane and, at this scroll
  // position, sits directly on top of the centre of this very line —
  // verified with `document.elementFromPoint`, which returned the toolbar,
  // not the paragraph, for a centred click here. The toolbar is narrower
  // than the pane, so its left edge clears well before the text does.
  await page.mouse.click(box!.x + 4, box!.y + box!.height / 2, { button: 'right' });

  const menu = page.getByRole('menu', CONTEXT_MENU);
  await expect(menu).toBeVisible();

  // The menu itself first mounts at its unflipped guess (`request.rect.bottom
  // + 4`, `EditorContextMenu`'s own initial `position` state) and corrects
  // in an effect once its real height exists — the same two-stage placement
  // `HeadingMenu` and the highlight palette both use. Polled rather than
  // read once, so this doesn't race that correction pass.
  await expect
    .poll(async () => {
      const menuBox = await menu.boundingBox();
      return menuBox === null ? null : menuBox.y + menuBox.height;
    })
    .toBeLessThanOrEqual(box!.y + box!.height / 2 + 1);
});

test('a table row inserts from the menu at the right-clicked cell', async ({ page }) => {
  await openNoteWithTable(page);

  // One header row plus one data row (`insertTable({ rows: 2, ... })`, one of
  // which is the header) — add a second data row through the menu itself so
  // there are two distinguishable rows to insert between.
  const firstCell = page.locator('.ProseMirror td').first();
  await firstCell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert row below' }).click();
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(3);

  const firstColumnCells = page.locator('.ProseMirror table tr td:first-child');
  await expect(firstColumnCells).toHaveCount(2);

  await firstColumnCells.nth(0).click();
  await page.keyboard.type('RowA');
  await firstColumnCells.nth(1).click();
  await page.keyboard.type('RowB');
  await expect(firstColumnCells).toHaveText(['RowA', 'RowB']);

  // Caret parked in RowA's cell...
  await firstColumnCells.nth(0).click();
  // ...but the right-click — and the row it inserts — targets RowB.
  await firstColumnCells.nth(1).click({ button: 'right' });
  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Insert row below' }).click();

  // The new empty row lands directly after RowB, not after RowA — which is
  // what the caret's own (unmoved) position would have produced instead.
  await expect(page.locator('.ProseMirror table tr td:first-child')).toHaveText([
    'RowA',
    'RowB',
    '',
  ]);
});

// --- CONTROLLER RULING R12: move the selection when the menu opens ---------

test('right-click a paragraph while the caret sits in a table shows no table section', async ({
  page,
}) => {
  await openNoteWithTable(page);

  // The caret is left inside the table's first cell by `insertTable` itself
  // (Tiptap's own post-insert behaviour) — no click needed to put it there.
  // Right-clicking the TITLE paragraph above the table, without an
  // intervening left click, is the exact repro for Finding 2: before R12,
  // `flags` reflected the stale (in-table) selection rather than the
  // right-clicked position, so the Table section showed up somewhere it
  // should not have been able to.
  const title = page.locator('.ProseMirror > p').first();
  await title.click({ button: 'right' });

  await expect(page.getByRole('menu', CONTEXT_MENU)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Table' })).toHaveCount(0);
});

test('right-clicking inside an existing selection preserves it, and Bold formats the whole run', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  // The same text `highlightWord` (Task 5, above) types, for the identical
  // reason: `getByText` on a single-text-node paragraph resolves to the
  // whole paragraph, not the word, so a pointer selection can't target
  // "marked" on its own — a keyboard selection can.
  await page.keyboard.type('plain marked plain');

  const paragraph = page.locator('.ProseMirror > p').first();
  await paragraph.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 'plain '.length; i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  for (let i = 0; i < 'marked'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  // Settled, not read once: ProseMirror's own selection lags the DOM's by
  // up to a tick after a bare keyboard selection, and right-clicking before
  // it catches up would race R12's own "is `pos` inside the selection?"
  // check with a stale range — the same class of race the flip test above
  // guards against with its own poll.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('marked');

  // Right-click ON the selected word itself — found by its own `Range`,
  // the same technique `highlightWord` and the bottom-edge flip test both
  // use, since the word has no element of its own to locate by role/text.
  const wordRect = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector('.ProseMirror')!,
      NodeFilter.SHOW_TEXT,
    );
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.indexOf('marked') ?? -1;
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'marked'.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  });
  expect(wordRect).not.toBeNull();
  await page.mouse.click(wordRect!.x + wordRect!.width / 2, wordRect!.y + wordRect!.height / 2, {
    button: 'right',
  });

  await page.getByRole('menuitemcheckbox', { name: 'Bold' }).click();

  // The whole word is bold — not merely a caret's worth of it, which is
  // what an unconditional `setTextSelection(request.pos)` at open time
  // would have collapsed this selection down to (Finding 3).
  await expect(page.locator('.ProseMirror strong')).toHaveText('marked');
});

test('the menu stays fully within the viewport at its tallest, opened low', async ({ page }) => {
  // A short viewport, deliberately: on the suite's default 1280x720, this
  // menu's natural height with its table section (~575px) always fits
  // SOMEWHERE — clamped to the top edge if nothing else — so flip/clamp
  // alone happens to hide the real defect there. A window this short is a
  // realistic case (a squat browser window, or a laptop with the app not
  // maximised), and on it, this menu's five sections plus a seven-row table
  // section genuinely cannot fit above OR below the click point at all —
  // only a height cap with its own scroll can, which is exactly Finding 1.
  await page.setViewportSize({ width: 1280, height: 400 });
  await openNoteWithTable(page);

  const cell = page.locator('.ProseMirror td').first();
  const cellBox = await cell.boundingBox();
  expect(cellBox).not.toBeNull();

  await page.mouse.click(cellBox!.x + cellBox!.width / 2, cellBox!.y + cellBox!.height / 2, {
    button: 'right',
  });

  const menu = page.getByRole('menu', CONTEXT_MENU);
  await expect(menu).toBeVisible();
  await expect(page.getByRole('group', { name: 'Table' })).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  // Polled, not read once: this menu (like the one in the flip test above)
  // has its own two-stage placement, and a stale first measurement — taken
  // before the table section's own render lands — is exactly the timing
  // Finding 1 caught. A single read could observe the same stale geometry
  // and pass by accident even against the fixed code.
  await expect
    .poll(async () => {
      const box = await menu.boundingBox();
      return box === null ? null : box.y + box.height;
    })
    .toBeLessThanOrEqual(viewport!.height);

  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  // Fully on-screen at BOTH edges, not just the bottom: a naive fix that
  // only clamped `top` downward without bounding height could still push
  // the top edge above y=0.
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height);
});

// --- Fix round 2, Finding 5: the palette must not pop behind the menu ------

test('right-clicking inside highlighted text shows only the context menu, not the floating palette too', async ({
  page,
}) => {
  await highlightWord(page);

  // The caret is already inside the mark right after applying the
  // highlight (see `highlightWord`), so the palette is up before the
  // right-click at all — this is deliberate: R12 moves the selection to
  // `request.pos` when the menu opens, which for a right-click ON the mark
  // itself lands the caret right back inside it, so `paletteAt`'s own effect
  // (driven by `flags.highlightRange`) would otherwise keep the palette
  // rendered at the same time as the menu, unconditionally.
  const palette = page.getByRole('menu', { name: 'Highlight colour' });
  await expect(palette).toBeVisible();

  const mark = page.locator('.ProseMirror mark');
  await mark.click({ button: 'right' });

  const menu = page.getByRole('menu', CONTEXT_MENU);
  await expect(menu).toBeVisible();
  // Exactly one highlight-choosing surface while the menu is open: the
  // menu's own swatch row covers the need, and the standalone palette must
  // step aside rather than rendering on top of (or behind) it.
  await expect(palette).toHaveCount(0);
});
