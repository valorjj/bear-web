import { expect, test } from '@playwright/test';

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import {
  ADOPTED_SYNC_SETTINGS,
  forwardPdfToRenderer,
  RENDERER_URL,
  signIn,
} from './fixtures/renderer.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * The PDF reference shots. A harness, not a test — `@shots` keeps it out of
 * `npm run test:e2e` through the existing `grepInvert`, and it asserts only
 * enough to fail loudly rather than write a blank page.
 *
 * Why it exists: `npm run shots` already photographs the exported HTML in all
 * sixteen themes, and that is a picture of the DOCUMENT, not of the PDF. The
 * two can diverge — the PDF is paginated, it is laid out at A4 rather than at
 * a viewport width, and it is produced by a different browser inside a
 * container with its own font set. Nothing else in this project can see the
 * difference.
 *
 * **Count the files (5), do not trust the exit code** — the same rule
 * `npm run shots` carries.
 *
 * Four themes rather than sixteen, spanning the roster's range: two light
 * (`paper`, `sepia`), two dark (`nord`, `high-contrast`). Sixteen A4 renders
 * through a container on a fanless machine is not a cost this earns.
 */
const SHOTS = 'docs/design/shots/pdf';

const THEMES = ['paper', 'sepia', 'nord', 'high-contrast'] as const;

/**
 * The note each theme renders, and one extra pass for callouts.
 *
 * The rich note carries headings, a table and highlights; it says nothing
 * about M9b. The callout note is rendered ONCE rather than in four themes,
 * because the risk it covers is not palette — `e2e/contrast.spec.ts` covers
 * that across all sixteen — but whether the CONTAINER'S Chromium draws a
 * `mask-image` data URI at all under print media. That either works or it does
 * not, and one render answers it. Nothing else in this project can: a text
 * extraction cannot see a missing glyph any more than it can see tofu.
 */
const NOTES = [
  ...THEMES.map((theme) => ({
    theme,
    note: /US market daily/,
    contains: 'One-line summary',
    name: theme,
  })),
  {
    theme: 'paper' as const,
    note: /배포 전 점검/,
    contains: '되돌릴 수 없습니다',
    name: 'callouts',
  },
];

for (const { theme, note, contains, name } of NOTES) {
  test(`exported PDF, ${name} @shots`, async ({ page }) => {
    test.skip(RENDERER_URL === '', 'set PDF_RENDERER_URL and run `npm run pdf:up`');

    await page.addInitScript((id: string) => {
      localStorage.setItem('bear-web:theme', id);
    }, theme);
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, {
      ...CORPUS,
      settings: [...CORPUS.settings, ...ADOPTED_SYNC_SETTINGS],
    });
    await signIn(page);
    await forwardPdfToRenderer(page, RENDERER_URL);

    await page.goto('/');
    await page.getByRole('button', { name: note }).click();
    await expect(page.getByRole('region', { name: 'Editor' })).toContainText(contains);

    await page.getByRole('button', { name: 'Export note' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /^PDF/ }).click();

    const pdf = join(tmpdir(), `bear-web-shot-${name}.pdf`);
    await (await download).saveAs(pdf);

    mkdirSync(SHOTS, { recursive: true });

    /*
     * poppler, from the host. A rasteriser is genuinely needed — a PDF is not
     * an image, and the whole point of this harness is to look at one — and
     * bringing a JS renderer in for four files a designer runs by hand is not
     * a dependency this repo should carry. `execFileSync` throws if poppler
     * is missing, which is the right failure: a silently unrasterised run
     * would leave an empty directory and a green exit code.
     */
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '144',
      '-f',
      '1',
      '-l',
      '1',
      pdf,
      join(SHOTS, `export-pdf-${name}`),
    ]);
  });
}
