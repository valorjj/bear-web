import { createRequire } from 'node:module';

import type { Browser } from 'playwright';

import { MERMAID_THEME_CSS } from './mermaidTheme.ts';
import { RenderTimeoutError, sharedBrowser } from './render.ts';
import { sanitizeInPage } from './sanitizeInPage.ts';
import { findUnsafeSvgConstructs } from './svgGuard.ts';

/**
 * Pinned exactly, matching the Dockerfile install. Imported by no one but
 * asserted by the Dockerfile check (`verify-fonts.mjs`-style build-time
 * assertion belongs to a later task; this constant is the single source the
 * Dockerfile line and any such check must agree with).
 */
export const MERMAID_VERSION = '11.17.2';

export interface MermaidRenderDeps {
  browser?: Browser;
  timeoutMs?: number;
}

/**
 * 5 s, against `/render`'s 10 s.
 *
 * A Mermaid render is ~100 ms. Five seconds is already pathological, and the
 * deadline is the only thing that bounds a page whose script does not yield —
 * `page.evaluate` accepts a timeout, but the same measurement that motivated
 * `render.ts`'s deadline applies: a per-call option does not stop work
 * Chromium has already committed to. Closing the context is what reclaims the
 * worker.
 */
const DEFAULT_TIMEOUT_MS = 5_000;

/** A Mermaid parse failure. Not a service failure: it is the single most likely
 * outcome of a user typing a diagram, it is not retryable, and its message is
 * information the user needs. Mapped to 422 by `server.ts`. */
export class MermaidSyntaxError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`mermaid syntax error: ${detail}`);
    this.name = 'MermaidSyntaxError';
    this.detail = detail;
  }
}

/** The in-page sanitizer produced markup `svgGuard` refuses. Mapped to 500:
 * this is our bug or a compromised page, never the user's input. */
export class SanitizerFailedError extends Error {
  readonly constructs: readonly string[];

  constructor(constructs: readonly string[]) {
    super(`sanitized svg still contains: ${constructs.join(', ')}`);
    this.name = 'SanitizerFailedError';
    this.constructs = constructs;
  }
}

/**
 * Resolved at call time, not at import: the file exists only inside the
 * container image, where the Dockerfile installs it. Resolving at import would
 * make every host-side test of this module fail on a missing package before
 * reaching an assertion.
 */
function mermaidBundlePath(): string {
  const require_ = createRequire(import.meta.url);
  return require_.resolve('mermaid/dist/mermaid.min.js');
}

/** The shape `page.evaluate` needs; the real types live only in the image. */
interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

/**
 * Renders one Mermaid source to sanitized SVG.
 *
 * Differences from `renderPdf`, both deliberate:
 *
 * - `javaScriptEnabled` is TRUE, and it has to be: Mermaid is a script. This
 *   is the one page in the system that executes third-party code over user
 *   input, which is why the sanitizer runs here AND `svgGuard` runs again
 *   afterward in this process and once more at the API boundary.
 * - the script is INJECTED from the container filesystem via `addScriptTag`
 *   with a `path`, never fetched: `render.ts`'s route abort and
 *   `--host-resolver-rules=MAP * ~NOTFOUND` mean the page has no network at
 *   all, and injecting by path reads the file in Node rather than navigating
 *   to `file://`.
 */
export async function renderMermaid(source: string, deps: MermaidRenderDeps = {}): Promise<string> {
  const owned = deps.browser === undefined;
  const browser = deps.browser ?? (await sharedBrowser());
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = await browser.newContext();

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const work = (async () => {
      const page = await context.newPage();
      await page.route('**', (route) => route.abort());
      await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>', {
        timeout: timeoutMs,
        waitUntil: 'load',
      });
      await page.addScriptTag({ path: mermaidBundlePath() });

      const result = await page.evaluate(
        async ({ diagram, themeCss }) => {
          const api = (globalThis as { mermaid?: MermaidApi }).mermaid;
          if (api === undefined) return { error: 'mermaid did not load' };

          api.initialize({
            startOnLoad: false,
            // Encodes HTML in labels rather than trusting it. Belt to the
            // sanitizer's braces.
            securityLevel: 'strict',
            // The reason the foreignObject rule costs nothing: labels become
            // real <text>, which also survives being inlined in the app.
            htmlLabels: false,
            flowchart: { htmlLabels: false },
            theme: 'base',
            themeCSS: themeCss,
            fontFamily: 'Pretendard, system-ui, sans-serif',
          });

          try {
            const { svg } = await api.render('d', diagram);
            return { svg };
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        },
        { diagram: source, themeCss: MERMAID_THEME_CSS },
      );

      if (result.error !== undefined) throw new MermaidSyntaxError(result.error);

      // Sanitized in the page, where a real DOM exists.
      return await page.evaluate(sanitizeInPage, result.svg);
    })();

    // The losing side of the race keeps running until `context.close()` tears
    // it down, and then rejects. Absorbed: an unhandled rejection kills the
    // process. Same reasoning as `render.ts`.
    work.catch(() => {});

    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => reject(new RenderTimeoutError()), timeoutMs);
    });

    const svg = await Promise.race([work, deadline]);

    const unsafe = findUnsafeSvgConstructs(svg);
    if (unsafe.length > 0) throw new SanitizerFailedError(unsafe);

    return svg;
  } catch (error) {
    if (error instanceof MermaidSyntaxError) throw error;
    if (error instanceof SanitizerFailedError) throw error;
    if (error instanceof RenderTimeoutError) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') throw new RenderTimeoutError();
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    await context.close().catch(() => {});
    if (owned) {
      // Nothing to do: the shared browser is reused, exactly as renderPdf
      // leaves it. Kept as an explicit no-op branch so a future change does
      // not mistake the absence for an oversight.
    }
  }
}
