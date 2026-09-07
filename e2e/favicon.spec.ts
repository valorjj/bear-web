import { expect, test } from '@playwright/test';

/**
 * Draws the favicon and counts what it paints.
 *
 * `scripts/favicon.test.ts` proves the file exists, is linked, and parses.
 * None of that can see the failure that matters most: an SVG that parses
 * perfectly and paints nothing. A stroke that fails to resolve, a viewBox that
 * puts the geometry outside the frame, a colour that matches its own ground —
 * each produces a valid document, a clean 200, and an empty tab icon.
 *
 * The canvas is only readable because the preview server serves the icon from
 * the same origin as the page. Loading it over `file://` taints the canvas and
 * `getImageData` throws, which is worth knowing before anyone tries to move
 * this into a unit test.
 */
async function paintedPixels(
  page: import('@playwright/test').Page,
): Promise<{ count: number; stroke: number[] | null }> {
  return page.evaluate(async () => {
    const image = new Image();
    image.src = '/favicon.svg';
    await image.decode();

    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.drawImage(image, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    let count = 0;
    let stroke: number[] | null = null;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 10) {
        count += 1;
        stroke ??= [data[i - 3]!, data[i - 2]!, data[i - 1]!];
      }
    }
    return { count, stroke };
  });
}

test('the favicon actually paints', async ({ page }) => {
  await page.goto('/');
  const { count, stroke } = await paintedPixels(page);

  // A blank icon reports zero. The real mark covers roughly 2,800 of 9,216
  // pixels at this size; the floor is deliberately far below that, because
  // this test exists to catch "nothing rendered", not to pin the artwork.
  expect(count).toBeGreaterThan(500);
  expect(stroke).not.toBeNull();
});

test('the favicon lightens for a dark tab strip', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const light = await paintedPixels(page);

  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await paintedPixels(page);

  expect(light.stroke).not.toBeNull();
  expect(dark.stroke).not.toBeNull();

  // Compared by luminance rather than by exact value: the point is that the dark
  // variant is BRIGHTER, not that it is one specific indigo.
  const luminance = (rgb: number[]): number =>
    0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  expect(luminance(dark.stroke!)).toBeGreaterThan(luminance(light.stroke!) + 20);
});
