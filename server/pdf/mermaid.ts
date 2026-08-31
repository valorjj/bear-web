import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import type { Browser } from 'playwright';

import { MERMAID_THEME_CSS } from './mermaidTheme.ts';
import { closeContext, RenderTimeoutError, sharedBrowser } from './render.ts';
import { sanitizeInPage } from './sanitizeInPage.ts';
import { findUnsafeSvgConstructs } from './svgGuard.ts';

/**
 * Pinned exactly, matching the Dockerfile install. Imported by no one but
 * asserted by `mermaid.test.ts`'s Dockerfile-reading test, which fails if
 * this constant and `server/docker/pdf/Dockerfile`'s pinned version ever
 * drift apart — exactly the class of drift that produced the selector
 * corrections in `mermaidTheme.ts`.
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
 * information the user needs. Mapped to 422 by `server.ts`. Thrown ONLY for a
 * rejection out of `mermaid.render()` itself — never for a missing bundle or
 * an `initialize()` failure, which are infrastructure failures and must not
 * read as the user's fault. See the read of `result` below. */
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
 * A stable, unique DOM id for one diagram's source.
 *
 * `api.render('d', diagram)` used to hardcode `'d'` for every diagram — fine
 * for one diagram per page, wrong the moment a note holds two. Mermaid
 * prefixes EVERY selector it emits (including the appended `themeCSS`) with
 * `#<id>`, and generates every internal reference (`url(#d-gradient)`,
 * `[id$="-arrowhead"]`) from the same id — verified against real 11.17.2
 * output for flowchart, sequence, class and a wide flowchart: zero
 * unprefixed selectors. So the scoping was never broken; the id was. Two
 * diagrams sharing DOM id `"d"` collide on the id itself (invalid HTML, and
 * `#d …` then matches elements under BOTH inlined SVGs, since CSS does not
 * enforce id uniqueness), which is what let one diagram's rules reach the
 * other's markup, and — because Mermaid's own boilerplate is unprefixed
 * `<style>` in NO scope at all until IT applies the `#id` prefix — an id
 * collision was the whole leak.
 *
 * Content-derived (not random) so the SAME diagram gets the SAME id across
 * repeated renders — nothing downstream depends on that today, but a random
 * id would make an otherwise-identical render's markup vary for no reason,
 * which is a needless source of future cache-diffing pain. Prefixed with a
 * letter because a CSS id may not start with a digit and a hex digest can.
 */
function diagramId(source: string): string {
  return `mmd-${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
}

/**
 * The in-page evaluation's result, tagged so the caller can tell an
 * infrastructure failure (bundle missing, `initialize()` throwing) apart from
 * a genuine Mermaid parse error. Collapsing these into one shape is what
 * used to make `renderMermaid` report "mermaid did not load" as a
 * `MermaidSyntaxError` — a 422 blaming the user's diagram for an outage.
 */
type MermaidEvalResult =
  | { kind: 'ok'; svg: string }
  | { kind: 'syntax'; message: string }
  | { kind: 'infra'; message: string };

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

      const result: MermaidEvalResult = await page.evaluate(
        async ({ diagram, themeCss, id }) => {
          const api = (globalThis as { mermaid?: MermaidApi }).mermaid;
          if (api === undefined) return { kind: 'infra' as const, message: 'mermaid did not load' };

          try {
            api.initialize({
              startOnLoad: false,
              // Encodes HTML in labels rather than trusting it. Belt to the
              // sanitizer's braces.
              securityLevel: 'strict',
              // The reason the foreignObject rule costs nothing: labels
              // become real <text>, which also survives being inlined in
              // the app.
              htmlLabels: false,
              flowchart: { htmlLabels: false },
              theme: 'base',
              themeCSS: themeCss,
              fontFamily: 'Pretendard, system-ui, sans-serif',
            });
          } catch (error) {
            // A misconfiguration or a broken bundle, never the user's
            // diagram — `initialize()` has not looked at `diagram` yet.
            return {
              kind: 'infra' as const,
              message: error instanceof Error ? error.message : String(error),
            };
          }

          try {
            const { svg } = await api.render(id, diagram);
            return { kind: 'ok' as const, svg };
          } catch (error) {
            // The one case that IS the user's fault: `render()` rejected on
            // the diagram source itself.
            return {
              kind: 'syntax' as const,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
        { diagram: source, themeCss: MERMAID_THEME_CSS, id: diagramId(source) },
      );

      if (result.kind === 'infra') {
        throw new Error(`mermaid render infrastructure failure: ${result.message}`);
      }
      if (result.kind === 'syntax') throw new MermaidSyntaxError(result.message);

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
    // Bounded and shared-browser-aware, exactly as `renderPdf` uses it: an
    // INJECTED browser (tests) is never torn down here, and a close that
    // hangs tears down the shared browser rather than pinning the worker the
    // deadline above exists to reclaim.
    await closeContext(context, owned);
  }
}
