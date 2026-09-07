import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Guards the one link whose failure is completely silent.
 *
 * A favicon that 404s does not warn, log, or break anything — the tab simply
 * shows the browser's default glyph, which is exactly what this app looked
 * like before the mark existed, so the regression is invisible unless someone
 * happens to notice its absence. That is the same shape as the `hover:bg-hover`
 * utility that emitted nothing for two milestones.
 *
 * Three things can break it independently, so all three are checked: the file
 * can be deleted, the link can be dropped from `index.html`, and the `href`
 * can drift from the filename. `public/` is copied verbatim into `dist/` by
 * Vite, so a root-relative href is correct here — `vite.config.ts` sets
 * `base: '/'` because the app is served from the apex domain.
 */
describe('favicon', () => {
  const html = readFileSync('index.html', 'utf8');

  it('exists in public/', () => {
    expect(existsSync('public/favicon.svg')).toBe(true);
  });

  it('is linked from index.html at the path it actually lives at', () => {
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.svg"');
  });

  it('declares the SVG type, so browsers prefer it over a guessed .ico', () => {
    expect(html).toContain('type="image/svg+xml"');
  });

  /**
   * The mark has to stay legible on a dark tab strip. At the light accent
   * (#5b4ad6) against dark browser chrome it is close to invisible, so the
   * file carries a `prefers-color-scheme` block. Nothing else can catch its
   * removal: the icon still renders, just too dim to make out.
   */
  it('adapts to a dark tab strip', () => {
    const svg = readFileSync('public/favicon.svg', 'utf8');
    expect(svg).toContain('prefers-color-scheme: dark');
  });
});
