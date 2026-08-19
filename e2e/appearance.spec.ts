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
    // Not `[role="region"]`: Pane.tsx renders `<section aria-label>`, whose
    // "region" role is implicit ARIA semantics, never reflected as a DOM
    // attribute. That selector always returns null here, which silently
    // turned the fill-vs-pane assertion below into "colour !== null" — always
    // true, whatever the button's actual background was.
    const pane = element.closest('section[aria-label]');
    return {
      borderWidth: own.borderTopWidth,
      background: own.backgroundColor,
      paneFound: pane !== null,
      paneBackground: pane === null ? null : getComputedStyle(pane).backgroundColor,
    };
  });

  // The two independent affordances the M6 defect removed. Either alone would
  // be enough to see the control; asserting both means restoring only one does
  // not quietly re-pass.
  expect(style.borderWidth).not.toBe('0px');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');

  // A null pane must fail loudly, not make the next assertion vacuously true
  // by comparing a colour string to `null`.
  expect(style.paneFound).toBe(true);

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

test('the two allowlisted suppressors hide the default ring; an ordinary control does not', async ({
  page,
}) => {
  // The global `:focus-visible` rule in src/styles/index.css was declared
  // outside any cascade layer, so it beat every Tailwind utility regardless
  // of specificity — including `focus-visible:outline-none` on both
  // allowlisted suppressors. `scripts/sourceLint.test.ts` can only see that
  // the marker *string* is present in each file; it cannot see whether the
  // suppression actually renders. This is the assertion that can.
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();

  const separator = page.getByRole('separator').first();
  const ordinaryButton = page.getByRole('button', { name: 'New note' });

  // `:focus-visible` does not match every focus method. A plain mouse click
  // does not reliably trigger it on a div with `tabIndex`, so the separator
  // is focused with the keyboard the way a real user tabbing through the
  // shell would.
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft'); // undo the width nudge from the line above

  const separatorOutline = await separator.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(separatorOutline).toBe('none');

  await editor.click();
  const editorOutline = await editor.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(editorOutline).toBe('none');

  // The control: an ordinary button is not in the suppressor allowlist, so
  // the global ring must still reach it. Without this, deleting the global
  // rule entirely would make the two assertions above pass trivially.
  // As above, a bare `.focus()` alone does not reliably flip the browser's
  // input-modality heuristic away from "mouse" (this page's last real input
  // was the `editor.click()` above) — a harmless keypress that the button
  // has no handler for does, without triggering a click.
  await ordinaryButton.focus();
  await page.keyboard.press('ArrowDown');
  const buttonOutline = await ordinaryButton.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(buttonOutline).toBe('solid');
});

test('the search field reads as a control at rest', async ({ page }) => {
  await page.goto('/');

  const search = page.getByRole('searchbox', { name: 'Search notes' });
  await expect(search).toBeVisible();

  const style = await search.evaluate((element) => {
    const own = getComputedStyle(element);
    // See the identical note in "a default button reads as a control at
    // rest": `[role="region"]` never matches Pane.tsx's `<section
    // aria-label>`, whose region role is implicit ARIA semantics rather than
    // a DOM attribute.
    const pane = element.closest('section[aria-label]');
    return {
      borderWidth: own.borderTopWidth,
      background: own.backgroundColor,
      paneFound: pane !== null,
      paneBackground: pane === null ? null : getComputedStyle(pane).backgroundColor,
    };
  });

  expect(style.borderWidth).not.toBe('0px');

  // A null pane must fail loudly, not make the next assertion vacuously true
  // by comparing a colour string to `null`.
  expect(style.paneFound).toBe(true);
  expect(style.background).not.toBe(style.paneBackground);
});

test('each pane reads as a card against the canvas behind it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region')).toHaveCount(3);

  const measured = await page.evaluate(() => {
    const canvas = getComputedStyle(document.body).backgroundColor;
    // Not `[role="region"]`: Pane.tsx renders `<section aria-label>`, whose
    // "region" role is implicit ARIA semantics, never reflected as a DOM
    // attribute. That selector matches zero elements, and an empty array
    // makes the loop below a no-op — the assertions never run and the test
    // passes vacuously regardless of what the panes look like. `aria-label`
    // is the attribute actually present, so it is what the selector needs.
    const panes = [...document.querySelectorAll('section[aria-label]')].map((pane) => {
      const style = getComputedStyle(pane);
      return {
        background: style.backgroundColor,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        boxShadow: style.boxShadow,
      };
    });
    return { canvas, panes };
  });

  expect(measured.panes.length).toBe(3);

  // A pane whose fill equals the ground is not a card. This is what fails if
  // a pane loses its own bg-* className (the editor pane's `bg-bg` was
  // missing until Task 2's fix round) or its radius. Transparent is checked
  // separately from "equals canvas": a transparent pane's computed
  // `backgroundColor` is the literal string `rgba(0, 0, 0, 0)`, never equal
  // to the canvas's own `rgb(...)` value, so the equality check alone would
  // pass even with no fill at all.
  for (const pane of measured.panes) {
    expect(pane.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(pane.background).not.toBe(measured.canvas);
    expect(pane.radius).toBeGreaterThan(0);
    // Depth is what separates a card from a flat rectangle against the
    // canvas — the app has no window chrome to do it for free. Nothing else
    // in this loop reads `boxShadow`, so `shadow-popover` could vanish from
    // `Pane.tsx` (the exact `--color-hover` shape: a Tailwind utility whose
    // theme key disappears emits nothing and warns nothing) and every other
    // assertion here would stay green.
    expect(pane.boxShadow).not.toBe('none');
  }
});

test('every sidebar row carries an icon', async ({ page }) => {
  await page.goto('/');

  const rows = page.getByRole('navigation', { name: 'Lists' }).getByRole('listitem');
  await expect(rows).toHaveCount(7);

  const withIcons = await rows.evaluateAll(
    (items) => items.filter((item) => item.querySelector('svg') !== null).length,
  );
  expect(withIcons).toBe(7);
});

test('the formatting toolbar is icons, not letters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const toolbar = page.getByRole('toolbar', { name: 'Formatting toolbar' });
  await expect(toolbar).toBeVisible();

  const shape = await toolbar.evaluate((element) => {
    const buttons = [...element.querySelectorAll('button')];
    return {
      total: buttons.length,
      withSvg: buttons.filter((b) => b.querySelector('svg') !== null).length,
      withText: buttons.filter((b) => (b.textContent ?? '').trim() !== '').length,
    };
  });

  expect(shape.total).toBeGreaterThan(0);
  expect(shape.withSvg).toBe(shape.total);
  expect(shape.withText).toBe(0);
});

test('every formatting toolbar control is reachable at a narrow viewport', async ({ page }) => {
  // At 900px the editor pane sits at its 300px minimum while uniform
  // icon-only buttons need ~408px, so Link, Code block and Quote overflow the
  // toolbar's width. The fix is a horizontal scroll on the toolbar itself
  // (`overflow-x-auto` in BottomToolbar.tsx), not a responsive collapse —
  // that decision is explicitly out of scope for this milestone. This test
  // proves nothing is unreachable, not that the layout looks any particular
  // way.
  //
  // Deliberately NOT `toBeInViewport()` and NOT a plain `.click()`: the
  // editor pane's own `overflow-y-auto` computes its `overflow-x` to `auto`
  // too (the CSS rule that a `visible` axis paired with a non-visible one
  // becomes `auto`), so even the UN-fixed toolbar remains scrollable and
  // clickable via the *pane's* scrollbar — Playwright's auto-scrolling
  // `.click()` reaches it either way, and so does `toBeInViewport()` (both
  // verified to pass against the un-fixed toolbar). That is the exact "only
  // reachable by discovering horizontal scroll with no affordance" defect
  // named in the brief: technically scrollable, by the wrong element, with
  // no visible cue. The fix scopes the scroll to the toolbar itself
  // (`overflow-x-auto` in BottomToolbar.tsx) so only the button row moves,
  // not the note's prose along with it — which is what this test verifies
  // by driving `scrollLeft` on the toolbar element directly and checking
  // that a clipped button actually enters ITS bounds, not just the
  // viewport's.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const toolbar = page.getByRole('toolbar', { name: 'Formatting toolbar' });
  await expect(toolbar).toBeVisible();

  const quote = toolbar.getByRole('button', { name: 'Quote' });

  const before = await toolbar.evaluate(
    (element, target) => {
      const toolbarBox = element.getBoundingClientRect();
      const buttonBox = (target as HTMLElement).getBoundingClientRect();
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        clipped: buttonBox.right > toolbarBox.right,
      };
    },
    await quote.elementHandle(),
  );

  // The toolbar must actually be narrower than its content at this width,
  // and Quote must actually start outside it — otherwise the scroll check
  // below would pass vacuously because there was nothing to reach.
  expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
  expect(before.clipped).toBe(true);

  const after = await toolbar.evaluate(
    (element, target) => {
      element.scrollLeft = element.scrollWidth;
      const toolbarBox = element.getBoundingClientRect();
      const buttonBox = (target as HTMLElement).getBoundingClientRect();
      return { withinToolbar: buttonBox.right <= toolbarBox.right + 1 };
    },
    await quote.elementHandle(),
  );

  // Scrolling the TOOLBAR's own `scrollLeft` — not the pane's, not the
  // page's — must bring Quote inside it. If the toolbar itself is not the
  // scrolling container (the un-fixed state), setting its `scrollLeft` is a
  // no-op and Quote's position never changes.
  expect(after.withinToolbar).toBe(true);

  // No regression at a comfortable width: `overflow-x-auto` must not
  // introduce a visible scrollbar or gap when there is nothing to scroll.
  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = await toolbar.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(wide.scrollWidth).toBeLessThanOrEqual(wide.clientWidth);
});

test('the prose column is measured on a wide window', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('A line of prose.');

  const widths = await editor.evaluate((element) => {
    const prose = element.closest('.ProseMirror') ?? element;
    // `[role="region"]` matches nothing here for the same reason noted in
    // the card test above: Pane.tsx's "region" role is implicit, not an
    // explicit attribute.
    const pane = prose.closest('section[aria-label]');
    // `getComputedStyle` resolves the `em`-valued `max-width`
    // (`--bear-line-width`) to an absolute pixel length here, so no unit
    // conversion is needed and no test has to know the token's current value.
    const lineWidthPx = Number.parseFloat(getComputedStyle(prose).maxWidth);
    return {
      prose: prose.getBoundingClientRect().width,
      pane: pane === null ? 0 : pane.getBoundingClientRect().width,
      lineWidthPx,
    };
  });

  // Relative, deliberately: M8's sliders move --bear-line-width itself, so the
  // property that must hold is "narrower than the pane", not a pixel count.
  expect(widths.pane).toBeGreaterThan(0);
  expect(widths.prose).toBeLessThan(widths.pane);

  // The upper-bound check alone cannot see a collapsed column: deleting
  // `width: 100%` from `.ProseMirror` in editor.css shrinks the flex item to
  // its content (a single short line, ~150px in a 1000px+ pane), and
  // `prose < pane` stays true. The contract is clamp-then-centre — the
  // rendered width should equal `min(--bear-line-width, pane width)` — so
  // assert the lower bound too, against the actual token value rather than a
  // pixel constant.
  const expected = Math.min(widths.lineWidthPx, widths.pane);
  expect(widths.prose).toBeGreaterThan(expected - 2);
});

test('a tag renders as a pill, distinct from the prose beside it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Sprint planning');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('see #work now');
  // The pill lifts while the cursor is inside the tag, so move the caret off
  // it before measuring — otherwise this test measures the suppressed state.
  await page.keyboard.press('End');

  const pill = editor.locator('.bear-tag');
  await expect(pill).toHaveCount(1);
  await expect(pill).toHaveText('#work');

  const measured = await pill.evaluate((element) => {
    const own = getComputedStyle(element);
    const prose = element.closest('p');
    return {
      color: own.color,
      background: own.backgroundColor,
      radius: Number.parseFloat(own.borderTopLeftRadius),
      proseColor: prose === null ? null : getComputedStyle(prose).color,
      proseBackground: prose === null ? null : getComputedStyle(prose).backgroundColor,
      proseFound: prose !== null,
    };
  });

  // A null lookup must fail, not satisfy the comparison — the trap that made
  // two assertions in this file vacuous until M7.5's final review.
  expect(measured.proseFound).toBe(true);
  expect(measured.color).not.toBe(measured.proseColor);
  // Not-transparent and not-equal-to-the-surrounding-prose are two different
  // failures, per the pane-card test above: a transparent pill's computed
  // `backgroundColor` is the literal string `rgba(0, 0, 0, 0)`, never equal to
  // the paragraph's own background, so the equality check alone would pass on
  // a pill with no fill at all.
  expect(measured.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(measured.background).not.toBe(measured.proseBackground);
  expect(measured.radius).toBeGreaterThan(0);
});

test('the editor chrome floats as pills clear of the pane edges', async ({ page }) => {
  // M8's shape change: both toolbars were full-width bars welded to the pane
  // edges from M4 to M7.5 — measured against Bear, the single largest reason
  // this editor read as a web page rather than an app. Nothing in the unit
  // suite can see the difference: the roles, labels, buttons and every
  // `getByRole` lookup are byte-identical before and after.
  await openNoteWithProse(page);

  const pane = page.getByRole('region', { name: 'Editor' });
  const paneBox = await pane.boundingBox();
  expect(paneBox).not.toBeNull();

  const surfaceBackground = await page
    .getByRole('textbox', { name: 'Note text' })
    .evaluate((element) => getComputedStyle(element).backgroundColor);

  for (const name of ['Top controls', 'Formatting toolbar']) {
    const toolbar = page.getByRole('toolbar', { name });
    await expect(toolbar).toBeVisible();

    const box = await toolbar.boundingBox();
    expect(box, name).not.toBeNull();
    if (box === null || paneBox === null) continue;

    // Inset on all four sides. A bar welded to an edge touches it; a floating
    // pill cannot. The 0.5 tolerance is for sub-pixel layout, not slack.
    expect(box.x, `${name} left inset`).toBeGreaterThan(paneBox.x + 0.5);
    expect(box.x + box.width, `${name} right inset`).toBeLessThan(paneBox.x + paneBox.width - 0.5);
    expect(box.y, `${name} top inset`).toBeGreaterThan(paneBox.y + 0.5);
    expect(box.y + box.height, `${name} bottom inset`).toBeLessThan(
      paneBox.y + paneBox.height - 0.5,
    );

    const style = await toolbar.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        radius: Number.parseFloat(computed.borderTopLeftRadius),
        background: computed.backgroundColor,
        shadow: computed.boxShadow,
        height: element.getBoundingClientRect().height,
      };
    });

    // Fully rounded, not merely soft-cornered: a pill's radius is at least
    // half its height. `rounded-sm` (4px on a 36px bar) would pass a
    // `> 0` check and still read as a rectangle.
    expect(style.radius, `${name} radius`).toBeGreaterThanOrEqual(style.height / 2 - 0.5);

    // Not-transparent and not-equal-to-the-surface are two different failures,
    // the same lesson as the pane-card test: a pill with no fill computes
    // `rgba(0, 0, 0, 0)`, a literal string never equal to the surface's own
    // colour, so an equality check alone passes on a pill that is invisible.
    expect(style.background, `${name} fill`).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.background, `${name} fill vs surface`).not.toBe(surfaceBackground);

    // Depth is the only thing separating a floating surface from the prose
    // behind it, since the fill is deliberately one subtle step from it.
    expect(style.shadow, `${name} shadow`).not.toBe('none');
  }
});

test('the writing surface reserves room for the floating toolbars', async ({ page }) => {
  // The toolbars overlay the prose rather than sitting in the flow, so the
  // padding that keeps text out from under them is load-bearing, not
  // decoration. Without the bottom reserve the last line of every note sits
  // permanently behind the formatting bar with no way to scroll it clear —
  // and the note still round-trips perfectly, so no other test in this project
  // would notice.
  await openNoteWithProse(page);

  const pane = page.getByRole('region', { name: 'Editor' });
  const paneBox = await pane.boundingBox();
  const padding = await page.getByRole('textbox', { name: 'Note text' }).evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      top: Number.parseFloat(computed.paddingTop),
      bottom: Number.parseFloat(computed.paddingBottom),
    };
  });

  expect(paneBox).not.toBeNull();
  if (paneBox === null) return;

  for (const [name, side] of [
    ['Top controls', 'top'],
    ['Formatting toolbar', 'bottom'],
  ] as const) {
    const box = await page.getByRole('toolbar', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    if (box === null) continue;

    // How far the pill reaches into the pane from its own edge. The reserve
    // has to cover that, or the pill overlaps text.
    const reach =
      side === 'top' ? box.y + box.height - paneBox.y : paneBox.y + paneBox.height - box.y;

    expect(
      padding[side],
      `${name}: ${side} reserve ${padding[side]} vs reach ${reach}`,
    ).toBeGreaterThanOrEqual(reach);
  }
});

test('the editor typography tokens reach the rendered prose', async ({ page }) => {
  // `--bear-line-width` was declared in M5.5, wired into `.ProseMirror` in
  // M7.5, and STILL inert at 1440x900 through M7.7, because 56em resolved wider
  // than the pane so the clamp never engaged. `--bear-para-spacing` and
  // `--bear-para-indent` were worse: nothing read them at all. A declared token
  // no rule consumes is indistinguishable from a token that does not exist, and
  // no source-level check can tell the difference — Tailwind and CSS both emit
  // nothing and say nothing.
  //
  // So this drives each token from the page and asserts the render moves. It is
  // the guard those three tokens never had, and it is why M8's sliders can be
  // built against them with confidence.
  await openNoteWithProse(page);

  const gapBetweenBlocks = async (): Promise<number> =>
    page.getByRole('textbox', { name: 'Note text' }).evaluate((element) => {
      const paragraph = [...element.children].find((child) => child.tagName === 'P');
      const list = [...element.children].find((child) => child.tagName === 'UL');
      if (paragraph === undefined || list === undefined) return Number.NaN;
      return list.getBoundingClientRect().top - paragraph.getBoundingClientRect().bottom;
    });

  const setToken = async (name: string, value: string): Promise<void> => {
    await page.evaluate(
      ([property, next]) => document.documentElement.style.setProperty(property, next),
      [name, value] as const,
    );
  };

  // Both blocks must actually be there, or every comparison below is vacuous.
  const restingGap = await gapBetweenBlocks();
  expect(Number.isNaN(restingGap)).toBe(false);

  // `--bear-para-spacing` is additional space on top of the base rhythm, which
  // is Bear's own semantics for the slider. 2em at 16px is 32px.
  await setToken('--bear-para-spacing', '2em');
  const spacedGap = await gapBetweenBlocks();
  expect(spacedGap - restingGap).toBeGreaterThan(30);
  await setToken('--bear-para-spacing', '0em');

  // `--bear-para-indent` reaches paragraphs. Read from computed style rather
  // than measured, because a first-line indent moves glyphs inside a box whose
  // own rect does not change.
  await setToken('--bear-para-indent', '3em');
  const indent = await page.getByRole('textbox', { name: 'Note text' }).evaluate((element) => {
    const paragraph = element.querySelector('p');
    return paragraph === null ? null : getComputedStyle(paragraph).textIndent;
  });
  expect(indent).toBe('48px');
  await setToken('--bear-para-indent', '0em');

  // `--bear-line-width` reaches the column, and — unlike before M8 — the clamp
  // engages at the default viewport rather than only on an unusually wide one.
  const clamped = await page.getByRole('textbox', { name: 'Note text' }).evaluate((element) => {
    const prose = element.closest('.ProseMirror') ?? element;
    const pane = prose.closest('section[aria-label]');
    return {
      prose: prose.getBoundingClientRect().width,
      pane: pane === null ? 0 : pane.getBoundingClientRect().width,
      max: Number.parseFloat(getComputedStyle(prose).maxWidth),
    };
  });
  expect(clamped.pane).toBeGreaterThan(0);
  // The whole point of the measured 40em: the token, not the pane, decides the
  // column at the ordinary window size the shots are taken at.
  expect(clamped.max).toBeLessThan(clamped.pane);
  expect(clamped.prose).toBeLessThan(clamped.max + 2);
  expect(clamped.prose).toBeGreaterThan(clamped.max - 2);
});

/*
 * The surface tier is what makes High Contrast an ordinary theme rather than a
 * mode every component branches on: it raises `--bear-border-width` to 2px and
 * drops both shadows to `none`, so its panes are separated by their borders
 * alone.
 *
 * That only works if every border in the app consumes the token. Tailwind's
 * `border` utilities hardcode 1px, so a theme could raise the token and change
 * nothing at all — and the source would look correct either way, exactly like
 * the `--color-hover` defect this file was written for. Only a rendered width
 * can answer it.
 */
test('every border consumes the theme width token', async ({ page }) => {
  await page.goto('/');

  async function renderedWidths(theme: string): Promise<string[]> {
    return page.evaluate((value) => {
      document.documentElement.setAttribute('data-theme', value);
      const widths: string[] = [];
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        for (const side of [
          'borderTopWidth',
          'borderBottomWidth',
          'borderLeftWidth',
          'borderRightWidth',
        ] as const) {
          if (style[side] !== '0px') widths.push(style[side]);
        }
      }
      return widths;
    }, theme);
  }

  const paper = await renderedWidths('paper');
  // Guards the guard: with no border anywhere, the equality below would hold
  // vacuously for every theme.
  expect(paper.length, 'no borders rendered at all').toBeGreaterThan(0);
  expect([...new Set(paper)]).toEqual(['1px']);

  const high = await renderedWidths('high-contrast');
  expect(high.length).toBeGreaterThan(0);
  expect([...new Set(high)]).toEqual(['2px']);
});

/*
 * Each row in the theme picker previews its own palette, by carrying its
 * `data-theme` on the swatch and being rendered inside it. That is what keeps
 * every colour out of TypeScript — a palette edit updates the picker for free.
 *
 * It only works because the theme blocks are keyed `[data-theme='…']` rather
 * than `:root[data-theme='…']`: `:root` matches the document element alone, so
 * the scoped form is load-bearing. Restoring `:root` would leave every swatch
 * showing the ACTIVE theme's accent — six identical dots, and an app that
 * still works perfectly. No structural test can see that.
 */
test('each theme swatch previews its own palette', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /theme|테마/i }).click();

  async function accentOf(name: RegExp): Promise<string> {
    return page
      .getByRole('menuitemradio', { name })
      .locator('span span')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
  }

  const indigo = await accentOf(/Indigo Light|인디고 라이트/);
  const paper = await accentOf(/^(Paper|페이퍼)$/);
  const high = await accentOf(/High Contrast|고대비/);

  for (const value of [indigo, paper, high]) {
    expect(value).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(indigo).not.toBe(paper);
  expect(paper).not.toBe(high);
  expect(indigo).not.toBe(high);
});
