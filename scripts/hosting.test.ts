import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Two facts that break the deployed site silently and are invisible to every
 * other test: the unit suite has no notion of a base path, and the Playwright
 * suite drives a preview server that happily serves whatever base was built.
 * A wrong `base` renders a blank page with 404s for every asset; a missing
 * CNAME quietly reverts Pages to `valorjj.github.io`, which is a DIFFERENT
 * SITE from the API host and therefore silently breaks the session cookie.
 */
describe('hosting', () => {
  it('serves from the domain root, not a repo subpath', () => {
    const config = readFileSync('vite.config.ts', 'utf8');

    expect(config).not.toContain('/bear-web/');
    expect(config).toMatch(/base:\s*'\/'/);
  });

  it('claims the apex domain for GitHub Pages', () => {
    // Vite copies `public/` verbatim into `dist/`, which is how Pages sees it.
    expect(readFileSync('public/CNAME', 'utf8').trim()).toBe('markflowing.com');
  });
});
