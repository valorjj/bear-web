import { mkdirSync, writeFileSync } from 'node:fs';

import { test, type Page } from '@playwright/test';

import { FIXED_NOW, type Corpus } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * How long a cold first load takes, across CPU and network.
 *
 * The third leg of the design harness, and the one that was missing for the
 * whole life of the project: `measure` answers "what is it, in numbers",
 * `shots` answers "what does it look like", and NOTHING answered "how long
 * before a person can read their first note". The eager-JS budget in
 * `scripts/bundleSize.test.ts` had therefore been anchored to itself through
 * seven raises — a proxy with no measurement of the thing it is a proxy FOR.
 *
 * Like the rest of the harness it ASSERTS NOTHING and is excluded from
 * `npm run test:e2e` (`grepInvert` on `@load` in `playwright.config.ts`). A
 * timing is not a pass/fail: it moves with the machine, and a threshold here
 * would either be so loose it never fired or so tight it fired on load.
 * Run it with `npm run measure:load` and read the table.
 *
 * **Its output is deliberately NOT committed** — unlike `measurements.md`,
 * which is deterministic geometry and is meant to diff. These numbers vary
 * run to run and would be pure churn, so `docs/design/load.md` is gitignored
 * the way `docs/design/shots/` is.
 *
 * ## Two things that made an earlier version of this lie, both worth keeping
 *
 * `Network.enable` must be sent BEFORE `Network.emulateNetworkConditions`,
 * or the throttle is silently ignored — no error, the numbers simply come
 * back unthrottled. The giveaway was a 1ms TTFB against a configured 150ms
 * latency, and FCP of 416ms that should have been ~2.3s.
 *
 * And the HTTP cache must be disabled, or only the FIRST of the three runs
 * is a cold load and the median reports a warm one. Clearing cookies does
 * not clear it.
 *
 * ## What it cannot see
 *
 * CDP's CPU throttling is a multiplier on THIS machine's processor, so 4x on
 * an M-series Mac is still quicker than a real mid-range Android: the CPU
 * column understates a budget phone. It also cannot emulate latency for the
 * document request on localhost, so TTFB always reads ~1ms where a real
 * origin would add its round trip.
 *
 * Read it for the SHAPE — which of CPU and network dominates — rather than as
 * a promise about anyone's handset.
 */

const PROFILES = {
  'slow-4g': { down: (1.6 * 1024 * 1024) / 8, latency: 150 },
  'fast-4g': { down: (9 * 1024 * 1024) / 8, latency: 85 },
  wifi: { down: (30 * 1024 * 1024) / 8, latency: 10 },
} as const;

/** A returning reader with a real list, which is the common cold load. */
const NOTES: Corpus = {
  notes: Array.from({ length: 12 }, (_unused, index) => ({
    id: `n-${index}`,
    title: `Note ${index}`,
    text: `Note ${index}\n\nSome body text for note number ${index}, long enough to render a preview line.`,
    createdAt: FIXED_NOW - index * 1000,
    updatedAt: FIXED_NOW - index * 500,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  })),
  settings: [],
};

const SCENARIOS = [
  { cpu: 4, net: 'slow-4g' },
  { cpu: 4, net: 'fast-4g' },
  { cpu: 4, net: 'wifi' },
  { cpu: 1, net: 'slow-4g' },
  { cpu: 1, net: 'wifi' },
] as const;

const RUNS = 3;

interface Sample {
  ttfb: number;
  fcp: number;
  domContentLoaded: number;
  jsNetwork: number;
  firstNote: number;
  editorReady: number;
}

async function throttle(page: Page, cpu: number, net: keyof typeof PROFILES): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  // `Network.enable` FIRST, or `emulateNetworkConditions` is silently
  // ignored. See this file's header.
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: PROFILES[net].down,
    uploadThroughput: (750 * 1024) / 8,
    latency: PROFILES[net].latency,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
}

async function readTimings(page: Page): Promise<Omit<Sample, 'firstNote' | 'editorReady'>> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1;
    const jsNetwork = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.endsWith('.js'))
      .reduce((sum, entry) => sum + entry.duration, 0);
    return {
      ttfb: Math.round(nav.responseStart),
      fcp: Math.round(fcp),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      jsNetwork: Math.round(jsNetwork),
    };
  });
}

const rows: string[] = [];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

for (const { cpu, net } of SCENARIOS) {
  test(`cold load: ${cpu}x CPU, ${net} @load`, async ({ page }) => {
    const samples: Sample[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      await seedDatabase(page, NOTES);
      await throttle(page, cpu, net);

      const started = Date.now();
      // `commit`, not `load`: the clock has to start at navigation, not after
      // the browser has already fetched everything being measured.
      await page.goto('/', { waitUntil: 'commit' });
      await page.getByRole('button', { name: /Note 0,/ }).waitFor();
      const firstNote = Date.now() - started;

      // The WRITER's path, which the split could regress while improving the
      // number above: the list appearing sooner is worth nothing to someone
      // who opened the app to type. Measured to the point the editor is
      // actually mounted, not merely requested.
      await page.getByRole('button', { name: /Note 0,/ }).click();
      await page.getByRole('textbox', { name: 'Note text' }).waitFor();
      const editorReady = Date.now() - started;

      samples.push({ ...(await readTimings(page)), firstNote, editorReady });
      await page.goto('about:blank');
    }

    const median = (key: keyof Sample): number =>
      [...samples].map((sample) => sample[key]).sort((a, b) => a - b)[Math.floor(RUNS / 2)]!;

    rows.push(
      `| ${cpu}x | ${net} | ${median('fcp')} | ${median('domContentLoaded')} | ` +
        `${median('jsNetwork')} | **${median('firstNote')}** | **${median('editorReady')}** |`,
    );
    console.log(`${cpu}x ${net}: first note in ${median('firstNote')}ms`);
  });
}

test.afterAll(() => {
  if (rows.length === 0) return;
  mkdirSync('docs/design', { recursive: true });
  writeFileSync(
    'docs/design/load.md',
    [
      '# Cold first load',
      '',
      `Generated by \`npm run measure:load\` — median of ${RUNS} cold loads per row,`,
      'HTTP cache disabled. Milliseconds. Not committed: these move with the',
      'machine. Read the SHAPE, not the absolute values; see the header of',
      '`e2e/load.spec.ts` for what this cannot see.',
      '',
      '| CPU | Network | FCP | DOMContentLoaded | JS transfer | First note visible | Editor ready |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n'),
    'utf8',
  );
});
