/**
 * The entry script named by an index.html, or `null`.
 *
 * Deliberately a regex over the served TEXT rather than a `DOMParser` walk:
 * the answer is one attribute, the document is this app's own build output,
 * and parsing a whole document to read it would cost more than it tells us.
 */
const ENTRY = /<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/;

export interface StaleBuildDeps {
  fetch?: typeof globalThis.fetch;
}

/**
 * Whether the page is running a build the server has since replaced.
 *
 * The asset hash IS the build identity — it changes precisely when the code
 * does — so this needs no `version.json`, no injected git SHA and no build
 * configuration at all. It compares the entry tag the running page was loaded
 * from against the entry tag the server is serving right now.
 *
 * It exists because GitHub Pages serves `index.html` with a fixed
 * `max-age=600` and allows no custom headers, so for ten minutes after a
 * deploy a browser keeps loading the previous bundle — and a tab opened
 * before a deploy keeps it indefinitely. That is invisible until it does
 * damage, and the damage it does here is specific: `publish` uploads a
 * RENDERED SNAPSHOT, so publishing from a stale tab bakes the old stylesheet
 * into a page that then looks wrong forever. It did exactly that three times
 * while sub-project W was being built.
 *
 * **It fails OPEN, in every branch.** Offline, a 503, a blocked request, a
 * document with no entry tag, a page with no entry tag: all return `false`.
 * A check that cannot run is not evidence of staleness, and this must only
 * ever add a warning — never take away the ability to publish. Getting that
 * direction wrong would turn a cosmetic problem into an outage.
 *
 * `cache: 'no-store'` is the one load-bearing option. Without it the request
 * is answered from the very cache that caused the problem, the comparison is
 * against itself, and the function can never return `true`.
 *
 * Inert under `npm run dev`, where the entry is `/src/main.tsx` and both
 * sides always agree. That is correct rather than merely tolerable: there is
 * no deploy to be behind.
 */
export async function isStaleBuild(deps: StaleBuildDeps = {}): Promise<boolean> {
  const doFetch = deps.fetch ?? globalThis.fetch;

  const running = document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
  if (running === null) return false;

  try {
    const response = await doFetch('/', { cache: 'no-store' });
    if (!response.ok) return false;

    const served = ENTRY.exec(await response.text())?.[1] ?? null;
    if (served === null) return false;

    return served !== running;
  } catch {
    return false;
  }
}
