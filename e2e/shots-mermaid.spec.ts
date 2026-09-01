import { expect, test } from '@playwright/test';

import { mkdirSync } from 'node:fs';

import type { Corpus, SeedNote } from './fixtures/corpus.ts';
import { FIXED_NOW } from './fixtures/corpus.ts';
import {
  ADOPTED_SYNC_SETTINGS,
  forwardDiagramToRenderer,
  RENDERER_URL,
  signIn,
} from './fixtures/renderer.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * The Mermaid reference shots. A harness, not a test — `@shots` keeps it out
 * of `npm run test:e2e` through the existing `grepInvert`, and it asserts
 * only enough to fail loudly rather than write a blank image.
 *
 * Why it exists: `mermaidTheme.ts`'s themed selector set (flowchart, sequence,
 * state, class, ER, pie) was checked against Mermaid's real output with
 * `getComputedStyle`, not by reading class names — but nothing in the repo
 * looks at a RENDERED diagram with eyes. A clipped label, a diagram type that
 * silently fell back to Mermaid's base palette, or a legible-in-isolation
 * colour that reads badly against a theme's surface are all invisible to
 * every other gate.
 *
 * **Count the files (12: six diagram types × two themes), do not trust the
 * exit code** — the same rule `npm run shots` and `npm run shots:pdf` carry.
 * It SKIPS silently without `PDF_RENDERER_URL`.
 *
 * Two themes rather than sixteen, spanning the roster: one light (`paper`),
 * one dark (`nord`). `mermaidTheme.ts`'s docblock already records that its
 * `var(--bear-*)` references let ONE render serve every theme — this harness
 * exists to look at the RESULT of that claim in two themes that differ in
 * every direction (background, surface, text), not to re-verify the claim
 * itself (`e2e/diagram.spec.ts`'s request-count assertion already does that).
 */
const SHOTS = 'docs/design/shots/mermaid';

const THEMES = ['paper', 'nord'] as const;

/**
 * The six diagram types `mermaidTheme.ts` themes by name, with sources
 * matched to the ones `server/pdf/mermaid.test.ts` already verified render
 * cleanly at the pinned Mermaid version.
 */
const TYPES = [
  { name: 'flowchart', source: 'flowchart TD\n  A[Start] --> B[End]' },
  {
    name: 'sequence',
    source: 'sequenceDiagram\n  participant Alice\n  Alice->>Bob: hi',
  },
  { name: 'state', source: 'stateDiagram-v2\n  [*] --> Idle' },
  { name: 'class', source: 'classDiagram\n  class A {\n    +go()\n  }' },
  { name: 'er', source: 'erDiagram\n  A ||--o{ B : has' },
  { name: 'pie', source: 'pie title T\n  "a" : 10\n  "b" : 20' },
] as const;

function noteFor(type: (typeof TYPES)[number]): SeedNote {
  return {
    id: `mermaid-shot-${type.name}`,
    title: `Mermaid ${type.name}`,
    text: `# Mermaid ${type.name}\n\n\`\`\`mermaid\n${type.source}\n\`\`\`\n`,
    createdAt: FIXED_NOW - 60_000,
    updatedAt: FIXED_NOW - 60_000,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  };
}

const corpus: Corpus = {
  notes: TYPES.map(noteFor),
  settings: ADOPTED_SYNC_SETTINGS,
};

for (const theme of THEMES) {
  for (const type of TYPES) {
    test(`mermaid ${type.name}, ${theme} @shots`, async ({ page }) => {
      test.skip(RENDERER_URL === '', 'set PDF_RENDERER_URL and run `npm run pdf:up`');

      await page.addInitScript((id: string) => {
        localStorage.setItem('bear-web:theme', id);
      }, theme);
      await page.clock.setFixedTime(FIXED_NOW);
      await seedDatabase(page, corpus);
      await signIn(page);
      await forwardDiagramToRenderer(page, RENDERER_URL);

      await page.goto('/');
      await page.getByRole('button', { name: new RegExp(`Mermaid ${type.name}`) }).click();

      const figure = page.locator('.bear-mermaid__figure[role="img"]');
      // The real container's queue and a cold Chromium launch can both take
      // a few seconds — well beyond the default 5s expect timeout.
      await expect(figure).toBeVisible({ timeout: 30_000 });
      await expect(figure.locator('svg')).toBeVisible();

      mkdirSync(SHOTS, { recursive: true });
      await figure.screenshot({ path: `${SHOTS}/${type.name}-${theme}.png` });
    });
  }
}
