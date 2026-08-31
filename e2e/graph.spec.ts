import { expect, test, type Page } from '@playwright/test';

import { CORPUS, FIXED_NOW, type Corpus, type SeedNote } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * L3's own harness. Nothing in the unit suite can prove the graph actually
 * takes over the shell, that a click on a real SVG node navigates a real
 * editor, or that the worker path is genuinely exercised — jsdom has no
 * `Worker` at all, so every unit test runs the synchronous fallback
 * (`src/features/graph/runLayout.ts`'s own docblock says as much). This file
 * exists to prove the seven things the unit suite structurally cannot.
 *
 * The fixed CORPUS (`e2e/fixtures/corpus.ts`) carries exactly one `[[link]]`
 * outside a code fence — `n-todo` -> `n-code` — and no unresolved one at all:
 * counted by reading the corpus, not assumed. `n-code`'s own fenced
 * `[[Sprint checklist]]` is inert and produces neither an edge nor a node.
 * With 13 notes seeded and 2 trashed (`allNoteIndex` excludes trash), the
 * graph the fixed corpus produces is 11 note-nodes, 1 edge, 9 degree-0
 * (unlinked) nodes, and ZERO ghosts — so the ghost-node test below seeds its
 * own tiny corpus with one deliberately unresolved link instead of asserting
 * a count of zero against the shared corpus, which would prove nothing about
 * ghost rendering at all.
 */

const CANVAS_LABEL = "Graph: 11 notes, 1 links, 9 unlinked, 0 links to notes that don't exist";

function canvas(page: Page) {
  return page.getByRole('img', { name: CANVAS_LABEL });
}

async function openGraph(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+G');
}

/**
 * Reads a node's screen-space position from its graph-space `(cx, cy)`
 * (its circle's own attributes) and the canvas's live `<g transform="…">`
 * (`translate(x y) scale(s)`, written by `usePanZoom` / `GraphCanvasFrame`),
 * the same math `zoomAt`/`panBy` use. This is what proves a node is framed
 * on open WITHOUT panning — the bug FIX 1 closes is that this used to be
 * false for roughly half of any real layout, because the canvas centred
 * nothing: graph-space `(0, 0)` landed at the SVG's own top-left corner.
 */
async function nodeScreenPosition(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  const circle = page.locator(`[data-node="${nodeId}"] circle`);
  const cx = Number(await circle.getAttribute('cx'));
  const cy = Number(await circle.getAttribute('cy'));

  const transform = await page.locator('svg > g').first().getAttribute('transform');
  const match = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(transform ?? '');
  if (match === null) throw new Error(`unparseable transform: ${String(transform)}`);
  const [, tx, ty, scale] = match.map(Number);

  return { x: tx! + cx * scale!, y: ty! + cy * scale! };
}

test.describe('graph', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
  });

  test('Mod+Shift+G opens the graph and the three panes are gone', async ({ page }) => {
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();

    await openGraph(page);

    await expect(canvas(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sidebar' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Note list' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Editor' })).toHaveCount(0);
  });

  test('opens FRAMED: a known node is already inside the viewport with no panning', async ({
    page,
  }) => {
    // This is the real guard for FIX 1. `layoutGraph` centres the settled
    // layout on graph-space (0,0), but the canvas used to apply no framing
    // of its own and started every session at `{ x: 0, y: 0, scale: 1 }` —
    // which puts graph-space origin at the SVG's own top-left corner, not
    // its centre, so roughly half of any real layout rendered off-screen
    // until panned by hand. Before the fix, this assertion fails: n-todo's
    // screen position lands well outside the canvas's own bounding box.
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();

    await openGraph(page);
    await expect(canvas(page)).toBeVisible();
    await expect(page.locator('[data-node]')).toHaveCount(11);

    // The svg element itself carries no `viewBox`, so `nodeScreenPosition`'s
    // coordinates are already pixels measured from the svg's OWN top-left
    // corner — comparing them straight against its width/height, not against
    // its page-absolute `boundingBox()`, is the correct check.
    const svgBox = (await page.getByRole('img').boundingBox())!;
    const position = await nodeScreenPosition(page, 'n-todo');

    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.x).toBeLessThanOrEqual(svgBox.width);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeLessThanOrEqual(svgBox.height);
  });

  test("the canvas's accessible name carries the real counts for the seeded corpus", async ({
    page,
  }) => {
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();

    await openGraph(page);

    // The exact string, not a partial match: this is the one place the four
    // live counts (notes, links, unlinked, ghosts) are all asserted together.
    await expect(canvas(page)).toBeVisible();
  });

  test('a ghost node renders with data-kind="ghost", at the count this seed produces', async ({
    page,
  }) => {
    // A dedicated, minimal corpus rather than the shared fixed one: the fixed
    // CORPUS has zero unresolved links (see the file docblock), so reusing it
    // here would only prove that no ghost appears when none should — nothing
    // about ghost rendering itself. One note with one link to a title nobody
    // has written produces exactly one ghost node.
    const notes: SeedNote[] = [
      {
        id: 'n-ghost-source',
        title: 'Alpha',
        text: 'Alpha\n\nLinks to [[Beta]], which nobody has written yet.\n',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ];
    const ghostCorpus: Corpus = { notes, settings: [] };

    await seedDatabase(page, ghostCorpus);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Alpha/ })).toBeVisible();

    await openGraph(page);
    await expect(page.getByRole('img')).toBeVisible();

    const ghosts = page.locator('[data-node][data-kind="ghost"]');
    await expect(ghosts).toHaveCount(1);
    await expect(page.locator('[data-node][data-kind="note"]')).toHaveCount(1);
  });

  test('clicking a note node opens that note and returns to the panes', async ({ page }) => {
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();

    await openGraph(page);
    await expect(canvas(page)).toBeVisible();

    // n-todo is "Sprint checklist", one of the two real (non-ghost) nodes the
    // fixed corpus's single edge produces. No panning first: the graph opens
    // FRAMED (FIX 1), so every seeded node is already reachable by a direct
    // click.
    await page.locator('[data-node="n-todo"]').click();

    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Editor' })).toContainText(
      'Rewrite the seed helper',
    );
    await expect(page.getByRole('button', { name: /^Sprint checklist/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('Escape closes the graph', async ({ page }) => {
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();

    await openGraph(page);
    await expect(canvas(page)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
    await expect(canvas(page)).toHaveCount(0);
  });

  /**
   * 450 unique, unlinked notes — comfortably over `WORKER_THRESHOLD` (400) —
   * so the graph's node count alone crosses into the worker path. No links
   * are needed for this: `runLayout` decides purely on `graph.nodes.length`.
   */
  function syntheticCorpus(count: number): Corpus {
    const notes: SeedNote[] = Array.from({ length: count }, (_, i) => ({
      id: `n-synth-${String(i)}`,
      title: `Synthetic note ${String(i)}`,
      text: `Synthetic note ${String(i)}\n\nBody text with nothing to link.\n`,
      createdAt: FIXED_NOW - i,
      updatedAt: FIXED_NOW - i,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    }));
    return { notes, settings: [] };
  }

  test('the worker path: 400+ nodes actually requests the layoutWorker chunk', async ({ page }) => {
    const requestedUrls: string[] = [];
    page.on('request', (request) => requestedUrls.push(request.url()));

    await seedDatabase(page, syntheticCorpus(450));
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Synthetic note/ }).first()).toBeVisible();

    await openGraph(page);

    // "Reaches ready" alone passes against a disabled worker too, since
    // `runLayout` falls back to the synchronous path on any worker failure —
    // see its docblock. The only thing that actually proves the worker ran
    // is that its bundle was FETCHED.
    await expect(page.getByRole('img')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-node]')).toHaveCount(450);

    expect(requestedUrls.some((url) => url.includes('layoutWorker'))).toBe(true);
  });

  test('label level-of-detail: zooming past LABEL_SCALE_THRESHOLD increases the labelled count', async ({
    page,
  }) => {
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();

    await openGraph(page);
    await expect(canvas(page)).toBeVisible();

    // A settled signal alone is not enough under contention: the canvas's
    // accessible name can match before every node has actually painted (seen
    // under 5-parallel-worker load, immediately after the 450-node worker
    // test — flaked once, passed in isolation and on a full-file rerun).
    // Wait for the real, deterministic node count first — an auto-retrying
    // assertion, not a fixed sleep — so what follows reads a DOM the layout
    // has actually finished with.
    await expect(page.locator('[data-node]')).toHaveCount(11);

    // At rest (scale 1): the fixed corpus's highest degree is 1, well under
    // `LABEL_DEGREE_THRESHOLD` (3), and nothing is hovered — so no node is
    // labelled yet. Asserted with `toHaveCount`, which retries, rather than a
    // one-shot `.count()` read straight after the state change above.
    await expect(page.locator('[data-label]')).toHaveCount(0);
    const atRest = 0;

    // 'Zoom in' is 1.25x per click, so one click alone crosses 1.2.
    await page.getByRole('button', { name: 'Zoom in' }).click();

    // Same reasoning again, on the other side of the state change: wait for
    // the deterministic post-zoom count (every node becomes labelled once
    // scale crosses `LABEL_SCALE_THRESHOLD`) rather than reading a snapshot
    // the instant the click handler returns, before React has necessarily
    // re-rendered under load.
    await expect(page.locator('[data-label]')).toHaveCount(11);
    const afterZoom = 11;

    expect(afterZoom).toBeGreaterThan(atRest);
  });
});
