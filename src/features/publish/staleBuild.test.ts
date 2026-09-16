import { describe, expect, it, vi } from 'vitest';

import { isStaleBuild } from './staleBuild';

/**
 * A response carrying an index.html whose entry tag names `src`.
 *
 * Shaped like the real one, `crossorigin` and all, because the attribute
 * order in Vite's output is what the extractor has to survive.
 */
function served(src: string): Response {
  const html = `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script></head><body><div id="root"></div></body></html>`;
  return new Response(html, { status: 200 });
}

/** The tag the running page was loaded from. */
function loaded(src: string | null): void {
  document.head.querySelectorAll('script').forEach((element) => {
    element.remove();
  });
  if (src === null) return;
  const element = document.createElement('script');
  element.type = 'module';
  element.setAttribute('src', src);
  document.head.append(element);
}

describe('isStaleBuild', () => {
  it('is stale when the served entry differs from the running one', async () => {
    loaded('/assets/index-OLD.js');
    const fetch = vi.fn(async () => served('/assets/index-NEW.js'));

    expect(await isStaleBuild({ fetch: fetch as unknown as typeof globalThis.fetch })).toBe(true);
  });

  it('is not stale when they match', async () => {
    loaded('/assets/index-SAME.js');
    const fetch = vi.fn(async () => served('/assets/index-SAME.js'));

    expect(await isStaleBuild({ fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false);
  });

  it('asks the server not to serve it from cache', async () => {
    // The whole point: a cached index.html names the cached bundle, so the
    // comparison would be against itself and could never report staleness.
    // Typed with the real signature rather than `async () => …`, or
    // `calls[0]` is the empty tuple and reading its second element does not
    // typecheck.
    loaded('/assets/index-A.js');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => served('/assets/index-A.js'));

    await isStaleBuild({ fetch });

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('fails OPEN when the request throws', async () => {
    // Offline, a blocked request, a CDN hiccup: none of these are evidence
    // that the build is stale, and a check that cannot run must never stop
    // the user publishing. Every branch below asserts the same direction.
    loaded('/assets/index-A.js');
    const fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    expect(await isStaleBuild({ fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false);
  });

  it('fails open on a non-OK response', async () => {
    loaded('/assets/index-A.js');
    const fetch = vi.fn(async () => new Response('', { status: 503 }));

    expect(await isStaleBuild({ fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false);
  });

  it('fails open when the served document has no entry tag', async () => {
    loaded('/assets/index-A.js');
    const fetch = vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 }));

    expect(await isStaleBuild({ fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false);
  });

  it('fails open when the running page has no entry tag', async () => {
    // Under `npm run dev` the entry is `/src/main.tsx` and this comparison is
    // inert either way, but a page with no module script at all must not be
    // reported as stale.
    loaded(null);
    const fetch = vi.fn(async () => served('/assets/index-NEW.js'));

    expect(await isStaleBuild({ fetch: fetch as unknown as typeof globalThis.fetch })).toBe(false);
  });
});
