import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

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
/**
 * `.ProseMirror` is `min-width: 12rem; max-width: min(var(
 * --bear-line-width), 100% - 3rem)` (`editor.css`, two separate
 * properties, deliberately not one nested `max(12rem, min(…))` inside
 * `max-width` — see that file's own comment for why a `max-width` cannot
 * enforce a floor at all: it only ever shrinks an item below its other
 * constraints, never grows it past them). The `3rem` reservation
 * guarantees the fold toggle's gutter is never clipped by
 * `EditorContent`'s own `overflow-auto` (the toggle's own reach past the
 * column's edge is `1.5rem`; `3rem` split evenly by centering gives
 * exactly `1.5rem` on each side), at the cost of narrowing the achieved
 * column below the raw token on any pane narrower than the token plus
 * 3rem (688px at the default 16px root font size). The `12rem` `min-width`
 * is a separate guarantee: without it, a pane narrow enough would collapse
 * the reservation-adjusted column toward zero width with nothing to catch
 * it. Chromium does not resolve a `min()` mixing an absolute length and a
 * percentage into a single used-value pixel number for `getComputedStyle`
 * — it reports the partially-resolved expression itself (e.g.
 * `"min(640px, 100% - 48px)"`), so `Number.parseFloat` on it is `NaN`.
 * This computes the effective clamp in the test instead of relying on the
 * browser to have resolved it.
 */
function measureProseClamp(element: Element): {
  prose: number;
  pane: number;
  tokenPx: number;
  effectiveMax: number;
} {
  const prose = element.closest('.ProseMirror') ?? element;
  const pane = prose.closest('section[aria-label]');
  const style = getComputedStyle(prose);
  const raw = style.getPropertyValue('--bear-line-width').trim();
  const emMatch = /^([\d.]+)em$/.exec(raw);
  const fontSizePx = Number.parseFloat(style.fontSize);
  const tokenPx = emMatch ? Number.parseFloat(emMatch[1]) * fontSizePx : Number.NaN;
  const paneWidth = pane === null ? 0 : pane.getBoundingClientRect().width;
  const RESERVED_PX = 48; // 3rem at the fixed 16px root font size.
  const FLOOR_PX = 192; // 12rem at the fixed 16px root font size.
  return {
    prose: prose.getBoundingClientRect().width,
    pane: paneWidth,
    tokenPx,
    effectiveMax: Math.max(FLOOR_PX, Math.min(tokenPx, paneWidth - RESERVED_PX)),
  };
}

/** Sets a `--bear-*` custom property on the root, the way M8's sliders do. */
async function setToken(
  page: import('@playwright/test').Page,
  name: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ([property, next]) => document.documentElement.style.setProperty(property, next),
    [name, value] as const,
  );
}

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

/*
 * M9a REVERSED M6's ruling for this strip, and this test changed shape with it
 * rather than being deleted.
 *
 * M6 gave the note-list header's buttons a border and a fill because without
 * them "New note" and "Move to trash" were indistinguishable from static text
 * until the pointer crossed them. That chrome made the header read as a row of
 * form controls, which was the single thing that most dated the app, so the
 * header now carries quiet controls in Bear's idiom.
 *
 * The affordance that replaces a resting fill is the HOVER fill, and that is
 * precisely the affordance this project has already lost once without noticing:
 * `--color-hover` was absent from the theme block for two milestones, so every
 * `hover:bg-hover` compiled to nothing, in silence. A quiet control whose hover
 * does not compile is invisible in every state, which is strictly worse than
 * what M6 fixed. So this asserts the hover fill really renders — and, because a
 * quiet control carries no text of its own, that its accessible name survives.
 *
 * `ConfirmDialog`'s Cancel still uses `default`, so the variant and M6's
 * reasoning both remain live where a control genuinely must read at rest.
 */
test('a quiet header control still has a hover affordance and a name', async ({ page }) => {
  await page.goto('/');

  const created = page.getByRole('button', { name: 'New note' });
  await expect(created).toBeVisible();

  const background = async (): Promise<string> =>
    created.evaluate((element) => getComputedStyle(element).backgroundColor);

  // Quiet at rest is the point, not an accident: if this ever gains a resting
  // fill the reversal has been undone and someone should notice.
  expect(await background()).toBe('rgba(0, 0, 0, 0)');

  await created.hover();

  // Polled, not read once. The fill TRANSITIONS in over
  // `--bear-duration-fast`, so a single read immediately after `hover()` can
  // catch the animation at 0% and see the resting transparent — which made
  // this test fail roughly one run in three. Polling still fails, by timing
  // out, when the fill genuinely never compiles; that was re-verified by
  // deleting `hover:bg-hover` from the ghost variant.
  await expect
    .poll(background, { message: 'the hover fill did not compile' })
    .not.toBe('rgba(0, 0, 0, 0)');
  const hovered = await background();

  // And it must differ from the pane, or the "fill" is invisible anyway — the
  // same trap the pane-card test documents.
  const pane = await created.evaluate((element) => {
    const section = element.closest('section[aria-label]');
    return section === null ? null : getComputedStyle(section).backgroundColor;
  });
  expect(pane, 'no pane found — a null here would make the check below vacuous').not.toBeNull();
  expect(hovered).not.toBe(pane);
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
        label: pane.getAttribute('aria-label') ?? '',
        background: style.backgroundColor,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        boxShadow: style.boxShadow,
      };
    });
    return { canvas, panes };
  });

  expect(measured.panes.length).toBe(3);

  /*
   * M9a narrowed this from "every pane is a card" to "every CONTENT pane is a
   * card", and the narrowing is a changed contract rather than a relaxed test.
   *
   * Soft Depth dissolves the sidebar into the ground — its `--bear-sidebar`
   * equals `--bear-canvas` in the indigo themes for exactly that reason — so
   * the old assertions would now be demanding the opposite of the design. The
   * sidebar is still asserted, in the negative and by name, so "the sidebar
   * quietly becomes a card again" fails here just as loudly as a content pane
   * losing its fill.
   */
  const sidebar = measured.panes.find((pane) => /sidebar|사이드/i.test(pane.label));
  const content = measured.panes.filter((pane) => !/sidebar|사이드/i.test(pane.label));

  expect(sidebar, 'no sidebar pane found').toBeDefined();
  expect(content.length).toBe(2);

  expect(sidebar!.boxShadow, 'the sidebar must not float').toBe('none');

  // A pane whose fill equals the ground is not a card. This is what fails if
  // a pane loses its own bg-* className (the editor pane's `bg-bg` was
  // missing until Task 2's fix round) or its radius. Transparent is checked
  // separately from "equals canvas": a transparent pane's computed
  // `backgroundColor` is the literal string `rgba(0, 0, 0, 0)`, never equal
  // to the canvas's own `rgb(...)` value, so the equality check alone would
  // pass even with no fill at all.
  for (const pane of content) {
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

  // `[role="region"]` matches nothing here for the same reason noted in the
  // card test above: Pane.tsx's "region" role is implicit, not an explicit
  // attribute. `measureProseClamp` resolves `--bear-line-width` itself
  // instead of reading `max-width` back from `getComputedStyle` — see its
  // own doc comment for why that stopped being reliable.
  const widths = await editor.evaluate(measureProseClamp);

  // Relative, deliberately: M8's sliders move --bear-line-width itself, so the
  // property that must hold is "narrower than the pane", not a pixel count.
  expect(widths.pane).toBeGreaterThan(0);
  expect(widths.prose).toBeLessThan(widths.pane);

  // At 1600x900 the editor pane is comfortably past the 688px threshold
  // where `min()`'s reservation branch would engage, so the effective clamp
  // is still the plain token value — this window size is deliberately wide
  // enough that this test is unaffected by the `3rem` reservation and stays
  // a pure "does the token reach the column" check.
  expect(widths.effectiveMax).toBeCloseTo(widths.tokenPx, 0);

  // The upper-bound check alone cannot see a collapsed column: deleting
  // `width: 100%` from `.ProseMirror` in editor.css shrinks the flex item to
  // its content (a single short line, ~150px in a 1000px+ pane), and
  // `prose < pane` stays true. The contract is clamp-then-centre — the
  // rendered width should equal the effective clamp — so assert both
  // bounds, against the actual token value rather than a pixel constant:
  // the lower bound alone would not catch a clamp applied UNconditionally
  // (e.g. narrower than the token even here, at a width where nothing
  // should narrow it).
  expect(widths.prose).toBeGreaterThan(widths.effectiveMax - 2);
  expect(widths.prose).toBeLessThan(widths.effectiveMax + 2);

  // None of the assertions above fail if `--bear-line-width` were ignored
  // entirely — at this viewport the pane-derived clamp and the token-derived
  // one coincide, so a rule that consumed only the pane width would satisfy
  // every check above too. Drive the token itself, the same way M8's slider
  // does, and confirm the render actually follows it — the guard this
  // test's own docstring says it exists to provide, restored. `20em` (320px),
  // not something smaller: `.ProseMirror`'s separate `min-width: 12rem`
  // (192px) floor would otherwise win instead of the token, which would
  // prove the floor works (already covered by its own test) rather than
  // that the token does.
  await setToken(page, '--bear-line-width', '20em');
  const shrunk = await editor.evaluate(measureProseClamp);
  expect(shrunk.tokenPx).toBeCloseTo(320, 0);
  expect(shrunk.effectiveMax).toBeCloseTo(320, 0);
  expect(shrunk.prose).toBeGreaterThan(300);
  expect(shrunk.prose).toBeLessThan(340);
  await setToken(page, '--bear-line-width', '40em');
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

  // Both blocks must actually be there, or every comparison below is vacuous.
  const restingGap = await gapBetweenBlocks();
  expect(Number.isNaN(restingGap)).toBe(false);

  // `--bear-para-spacing` is additional space on top of the base rhythm, which
  // is Bear's own semantics for the slider. 2em at 16px is 32px.
  await setToken(page, '--bear-para-spacing', '2em');
  const spacedGap = await gapBetweenBlocks();
  expect(spacedGap - restingGap).toBeGreaterThan(30);
  await setToken(page, '--bear-para-spacing', '0em');

  // `--bear-para-indent` reaches paragraphs. Read from computed style rather
  // than measured, because a first-line indent moves glyphs inside a box whose
  // own rect does not change.
  await setToken(page, '--bear-para-indent', '3em');
  const indent = await page.getByRole('textbox', { name: 'Note text' }).evaluate((element) => {
    const paragraph = element.querySelector('p');
    return paragraph === null ? null : getComputedStyle(paragraph).textIndent;
  });
  expect(indent).toBe('48px');
  await setToken(page, '--bear-para-indent', '0em');

  // `--bear-line-width` reaches the column, and — unlike before M8 — the clamp
  // engages at the default viewport rather than only on an unusually wide one.
  // At THIS test's default (1280x720) viewport the editor pane is 656px —
  // inside the band where `.ProseMirror`'s `min(token, 100% - 3rem)` (see
  // `measureProseClamp`'s own doc comment) reserves margin for the fold
  // toggle's gutter rather than the raw token deciding the column:
  // the effective clamp here is `pane - 3rem`, narrower than the plain 40em
  // token, and that reservation — not the token alone — is what the
  // rendered column must match at this width.
  const clamped = await page
    .getByRole('textbox', { name: 'Note text' })
    .evaluate(measureProseClamp);
  expect(clamped.pane).toBeGreaterThan(0);
  expect(clamped.effectiveMax).toBeLessThan(clamped.pane);
  expect(clamped.prose).toBeLessThan(clamped.effectiveMax + 2);
  expect(clamped.prose).toBeGreaterThan(clamped.effectiveMax - 2);

  // At THIS viewport the pane-derived reservation and the token happen to
  // agree with every check above regardless of whether the token is read at
  // all (40em is comfortably wider than the 608px reservation-adjusted
  // clamp, so the reservation always wins here). Drive the token itself,
  // the same way the two tokens above were driven, to prove the rule
  // actually reads `--bear-line-width` rather than merely reserving margin
  // off the pane: set it small enough to become the binding constraint even
  // inside the reservation band, and confirm the render follows. `20em`
  // (320px), not something smaller: `.ProseMirror`'s separate
  // `min-width: 12rem` (192px) floor would otherwise win instead of the
  // token, which would prove the floor works (already covered by its own
  // test) rather than that the token does.
  await setToken(page, '--bear-line-width', '20em');
  const shrunk = await page.getByRole('textbox', { name: 'Note text' }).evaluate(measureProseClamp);
  expect(shrunk.tokenPx).toBeCloseTo(320, 0);
  expect(shrunk.effectiveMax).toBeCloseTo(320, 0);
  expect(shrunk.prose).toBeGreaterThan(300);
  expect(shrunk.prose).toBeLessThan(340);
  await setToken(page, '--bear-line-width', '40em');
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

/*
 * The heading scale is one token, not three sizes.
 *
 * h1/h2/h3 are `--bear-heading-ratio` cubed, squared and itself, so they cannot
 * drift out of proportion with one another. This drives the ratio from the page
 * and asserts every heading moves — the same guard `--bear-line-width` and the
 * two paragraph tokens went without for three milestones, when a declared token
 * that no rule consumed was indistinguishable from one that did not exist.
 */
test('the editor heading ratio reaches every heading', async ({ page }) => {
  // Its own document rather than `openNoteWithProse`, which types only an h1.
  // Widening that shared fixture would change what eight other tests measure.
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  // Typed, never filled: `# ` is an input rule, and `fill` bypasses input
  // rules entirely, leaving literal text and no headings to measure.
  await editor.pressSequentially('# One');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('## Two');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('### Three');

  const sizes = async (): Promise<number[]> =>
    page.getByRole('textbox', { name: 'Note text' }).evaluate((element) =>
      ['h1', 'h2', 'h3'].map((tag) => {
        const heading = element.querySelector(tag);
        return heading === null ? Number.NaN : parseFloat(getComputedStyle(heading).fontSize);
      }),
    );

  const before = await sizes();
  for (const size of before) expect(Number.isNaN(size)).toBe(false);

  // Ordered, and strictly: an h2 equal to its h3 is a scale that has collapsed.
  expect(before[0]!).toBeGreaterThan(before[1]!);
  expect(before[1]!).toBeGreaterThan(before[2]!);

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bear-heading-ratio', '1.6');
  });

  const after = await sizes();
  for (const [index, size] of after.entries()) {
    expect(size, `heading ${index + 1} ignored the ratio`).toBeGreaterThan(before[index]!);
  }

  // Cubed, squared, itself: raising the ratio must move h1 by more than h3, or
  // the three are not actually derived from one number.
  expect(after[0]! - before[0]!).toBeGreaterThan(after[2]! - before[2]!);
});

/*
 * In Soft Depth the sidebar dissolves into the ground and only the panes
 * holding content float. That is a `Pane` prop rather than a `shadow-none` the
 * caller appends, because two utilities in the same layer are resolved by
 * STYLESHEET order and not by the order they appear in the class attribute — an
 * appended `shadow-none` silently did nothing, and the sidebar kept an
 * elevation nobody could see in the source.
 */
test('only the content panes are elevated, and their elevation is themed', async ({ page }) => {
  await page.goto('/');

  async function shadows(theme: string): Promise<Record<string, string>> {
    return page.evaluate((value) => {
      document.documentElement.setAttribute('data-theme', value);
      return Object.fromEntries(
        [...document.querySelectorAll('section[aria-label]')].map((pane) => [
          pane.getAttribute('aria-label')!,
          getComputedStyle(pane).boxShadow,
        ]),
      );
    }, theme);
  }

  const indigo = await shadows('indigo-light');
  // Guards the guard: a selector matching nothing would make every check below
  // vacuously true.
  expect(Object.keys(indigo).length).toBe(3);

  const sidebar = Object.entries(indigo).find(([label]) => /sidebar|사이드/i.test(label))![1];
  const content = Object.entries(indigo).filter(([label]) => !/sidebar|사이드/i.test(label));

  expect(sidebar, 'the sidebar must not float').toBe('none');
  for (const [label, value] of content) {
    expect(value, `${label} lost its elevation`).not.toBe('none');
  }

  // And the elevation is a theme's to define, not a constant. High Contrast
  // replaces it with a hard ring, because nothing can be elevated on black.
  const high = await shadows('high-contrast');
  for (const [label, value] of Object.entries(high)) {
    if (/sidebar|사이드/i.test(label)) continue;
    expect(value, `${label} kept indigo's shadow under High Contrast`).not.toBe(indigo[label]);
  }
});

test('a chosen theme survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /theme|테마/i }).click();
  await page.getByRole('menuitemradio', { name: /^(Ink|잉크)$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
});

/*
 * The mirror exists solely to beat first paint, so asserting after load proves
 * nothing: a late-stamping implementation still ends up correct, just with a
 * visible flash of the wrong theme on every launch.
 *
 * The discriminator is `<body>`. The inline script sits in `<head>`, so it runs
 * while the parser is still inside the head and BEFORE `<body>` exists. Any
 * JavaScript-driven alternative — a React effect, a module script — necessarily
 * runs after the document has been parsed. So "was the attribute already set
 * when body first appeared" separates the two exactly.
 *
 * Note the init script cannot touch `document.documentElement` at
 * `document_start`: it is still null there, and reading it throws before
 * anything is recorded, which is silent and looks exactly like "never stamped".
 */
test('the theme is stamped before first paint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /theme|테마/i }).click();
  await page.getByRole('menuitemradio', { name: /^(Ink|잉크)$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');

  await page.addInitScript(() => {
    const record: string[] = [];
    (window as unknown as { __atBody: string[] }).__atBody = record;
    new MutationObserver((_records, observer) => {
      if (document.body === null) return;
      record.push(String(document.documentElement.getAttribute('data-theme')));
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });

  await page.reload();

  const atBody = await page.evaluate(() => (window as unknown as { __atBody: string[] }).__atBody);
  expect(atBody.length, 'the observer never saw body appear').toBe(1);
  expect(atBody[0], 'the theme was not applied until after the document was parsed').toBe('ink');
});

/*
 * A note's first line reads as its title WITHOUT the user typing `#`, and is
 * set off from the body by space rather than a rule — Bear's behaviour, done in
 * CSS alone so the stored Markdown is untouched.
 *
 * The document is deliberately plain paragraphs. Typing `# ` would make the
 * first block a real heading and the test would pass on the heading rule alone,
 * proving nothing about the title treatment. `deriveTitle` already takes the
 * first line, so this only makes visible a relationship the data layer has
 * always had.
 */
test('the first line reads as a title, separated by space and not a rule', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Plain first line');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('Body one');
  await page.keyboard.press('Enter');
  await editor.pressSequentially('Body two');

  const measured = await editor.evaluate((element) => {
    const blocks = [...element.children].filter((child) => child.tagName === 'P');
    if (blocks.length < 3) return null;
    const read = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        size: Number.parseFloat(style.fontSize),
        weight: Number.parseInt(style.fontWeight, 10),
        top: node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
      };
    };
    const [title, first, second] = blocks.map(read);
    return {
      title,
      titleGap: first!.top - title!.bottom,
      bodyGap: second!.top - first!.bottom,
      bodySize: first!.size,
      bodyWeight: first!.weight,
    };
  });

  expect(measured, 'expected three paragraphs').not.toBeNull();

  // A title, not merely the first paragraph.
  expect(measured!.title.size).toBeGreaterThan(measured!.bodySize);
  expect(measured!.title.weight).toBeGreaterThan(measured!.bodyWeight);

  // The separator is space, and it is bigger than the ordinary block rhythm —
  // that difference is the whole point, and equal gaps would mean the rule
  // silently stopped applying while every other assertion still passed.
  expect(measured!.titleGap).toBeGreaterThan(measured!.bodyGap);
});

test('the fold toggle stays inside the visible editor at every pane width, wide or narrow', async ({
  page,
}) => {
  // The toggle and badge are absolutely positioned at a negative inline
  // offset from the heading (`editor.css`'s `.bear-fold-toggle` /
  // `.bear-fold-badge`), on the deliberate ruling that reserving a lane on
  // the PROSE would narrow the measured `--bear-line-width` at every pane
  // width. `.bear-fold-badge`'s `-1.5rem` exactly cancels `.ProseMirror`'s
  // own `1.5rem` padding, so the badge always lands flush with the prose
  // column's own edge — it never usefully distinguishes "wide" from
  // "narrow", which is why this test measures the toggle instead, at
  // `-3rem`, one badge-width further out.
  //
  // `EditorContent` (`RichEditor.tsx`, the direct parent of `.ProseMirror`)
  // is the actual clipping boundary: it sets `overflow-auto`, and content
  // past its own edge on the start side is neither visible nor reachable by
  // scrolling — a `boundingBox()` comparison against `.ProseMirror` or the
  // note-list pane cannot see this, because a layout box is reported
  // regardless of an ancestor's clip. This test measures `EditorContent`'s
  // own real `getBoundingClientRect()` instead, which is the one comparison
  // that can actually fail: before `.ProseMirror`'s `min-width: 12rem;
  // max-width: min(var(--bear-line-width), 100% - 3rem)` fix, the toggle's
  // `x` fell BELOW this boundary at a narrow pane, and a real Playwright
  // `.click()` at that position landed on the app shell instead of the
  // button (reproduced in `e2e/notes.spec.ts`'s fold-and-reload test at the
  // suite's own default 1280x720 viewport).
  await seedDatabase(page, {
    notes: [
      {
        id: 'n-fold-gutter',
        title: 'Alpha',
        text: '## Alpha\n\nbody',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  const toggle = heading.locator('[data-fold-toggle]');
  const proseMirror = page.locator('.ProseMirror').first();

  const viewport = page.viewportSize()!;

  async function toggleClearance(): Promise<number> {
    await heading.hover();
    const toggleBox = (await toggle.boundingBox())!;
    const editorContentX = await proseMirror.evaluate(
      (el) => (el.parentElement as HTMLElement).getBoundingClientRect().x,
    );
    return toggleBox.x - editorContentX;
  }

  // Wide: the pane has room to spare beyond the clamped measure (816px pane
  // at 1440x900, per `editor.css`'s own comment), so the toggle sits deep
  // inside `EditorContent`'s box — comfortably positive clearance.
  await page.setViewportSize({ width: 1440, height: viewport.height });
  const wideClearance = await toggleClearance();
  expect(wideClearance).toBeGreaterThan(48);

  // Narrow: the pane is well under the clamped measure, so the fix's
  // guaranteed reservation is the ONLY thing between the toggle and
  // `EditorContent`'s clip boundary. The reservation (`3rem` total, split
  // evenly by centering into `1.5rem` each side) is deliberately sized to
  // exactly cancel the toggle's own `1.5rem` reach past the column's edge —
  // no more — so clearance here is expected to land at exactly zero: the
  // toggle's edge exactly meets `EditorContent`'s own edge, neither past it
  // (clipped, the original bug) nor comfortably inside it (which would mean
  // more margin was reserved than necessary, narrowing the column further
  // than it has to be). Zero is therefore the PASSING value, not a
  // boundary to avoid — `toBeGreaterThanOrEqual(0)` is the guarantee this
  // fix actually makes, and it still discriminates: reverting the CSS
  // reservation entirely reproduces the pre-fix `-24` clearance measured
  // when this test was first written (see the task's fix report for that
  // RED run), which fails this same assertion.
  await page.setViewportSize({ width: 900, height: viewport.height });
  const narrowClearance = await toggleClearance();
  expect(narrowClearance).toBeGreaterThanOrEqual(0);
  expect(narrowClearance).toBeLessThan(wideClearance);
  // A small float tolerance above zero, not a wide band: this pins the
  // reservation to "exactly sufficient," not "generously more than
  // sufficient" — a regression that reserved 6rem again (comfortably
  // clipping-free but narrowing the column more than necessary) would still
  // pass `toBeGreaterThanOrEqual(0)` above but fails this upper bound.
  expect(narrowClearance).toBeLessThanOrEqual(4);

  await page.setViewportSize(viewport);
});

test('the prose column never collapses to zero at a very narrow pane', async ({ page }) => {
  // `.ProseMirror`'s `min-width: 12rem` (`editor.css`) is the floor `min()`
  // alone cannot provide: `max-width: min(var(--bear-line-width), 100% -
  // 3rem)` has no lower bound of its own, so at a pane narrow enough for
  // `100% - 3rem` to approach zero, the effective clamp would too — and
  // Chromium renders that as a genuinely collapsed column, not an error.
  // Nothing else in this app drives the editor pane this narrow today (the
  // note list and sidebar resizers have their own 160px floor; the editor
  // pane itself has none), which is exactly why this was silent until a
  // test actually looked at this width.
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('A line of prose.');

  // 720 total width puts the editor pane at roughly 96px — well under the
  // 240px (12rem floor + 3rem reservation) point where the floor must take
  // over, and confirmed not to break the rest of the shell's own layout.
  await page.setViewportSize({ width: 720, height: 800 });

  const widths = await editor.evaluate(measureProseClamp);
  expect(widths.pane).toBeLessThan(150);
  expect(widths.prose).toBeCloseTo(192, 0);

  // The floor must win regardless of how narrow the pane gets past that
  // point too, not merely at one sampled width.
  await page.setViewportSize({ width: 650, height: 800 });
  const narrower = await editor.evaluate(measureProseClamp);
  expect(narrower.prose).toBeCloseTo(192, 0);
});
