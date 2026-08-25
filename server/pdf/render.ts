import { chromium, type Browser, type BrowserContext } from 'playwright';

export interface RenderDeps {
  /** Injected so tests share one browser instead of launching per case. */
  browser?: Browser;
  timeoutMs?: number;
}

export class RenderTimeoutError extends Error {
  constructor() {
    super('render timed out');
    this.name = 'RenderTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

let shared: Browser | null = null;

/**
 * `MAP * ~NOTFOUND` fails every hostname resolution inside the browser
 * process, independently of the per-page route abort — a second, cheaper
 * layer for whatever the first one misses.
 *
 * Measured inside the container on 2026-08-25, with the route abort removed
 * so this layer was tested ALONE: with these args both
 * `http://localhost:9999/` and `http://127.0.0.1:9999/` failed; with an empty
 * args list both reached a listener. So it stops literal IPs as well as
 * hostnames — Chromium routes literal addresses through its host resolver
 * too — which is more than "a DNS control" would suggest, and worth knowing
 * before anyone weakens the rule to a hostname pattern.
 *
 * It does NOT replace the route abort, which remains control 2 and the thing
 * actually proven by fault injection. This is the layer underneath it.
 */
const EGRESS_DENY_ARGS = ['--host-resolver-rules=MAP * ~NOTFOUND'];

export async function sharedBrowser(): Promise<Browser> {
  shared ??= await chromium.launch({ args: EGRESS_DENY_ARGS });
  return shared;
}

export async function closeSharedBrowser(): Promise<void> {
  const browser = shared;
  shared = null;
  await browser?.close();
}

/**
 * Name only. This deliberately does NOT also match /timeout/i against the
 * message: the wall-clock deadline below is now the real timeout source, so
 * the message match bought nothing and cost precision — any unrelated failure
 * whose text happens to contain the word ("Navigation timeout of…", but also
 * a page's own error string) would be reported to the client as 504 "try
 * again shortly" when the truth is 500.
 */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/**
 * Bounded, because a close that hangs would pin the very worker the deadline
 * below exists to reclaim.
 *
 * When the bound is hit the context is abandoned, which leaves a live renderer
 * process behind. Waiting for the every-50-renders restart to reap it means up
 * to 50 more renders sharing the machine with a runaway Chromium, so the
 * shared browser is torn down immediately instead — the next render lazily
 * relaunches it. An INJECTED browser (tests) is never closed here: it belongs
 * to the caller, and killing it would take out the rest of the suite.
 */
const CLOSE_TIMEOUT_MS = 5_000;

async function closeContext(context: BrowserContext, owned: boolean): Promise<void> {
  const closed = await Promise.race([
    context.close().then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS)),
  ]);

  if (!closed && owned) await closeSharedBrowser().catch(() => {});
}

/**
 * Renders one standalone HTML document to a PDF.
 *
 * Every option here is load-bearing:
 *
 * - `javaScriptEnabled: false` — the export document contains no scripts, so
 *   deny the capability rather than trust the content to lack it.
 * - the route abort — no subresource loads at all. This is the SSRF control:
 *   an img, a link, an iframe or an @font-face url all die here. Fonts come
 *   from the image, so nothing legitimate needs the network.
 * - `setContent`, never `goto` — no client-controlled URL and no file://.
 * - `emulateMedia({ media: 'screen' })` — page.pdf() applies PRINT media by
 *   default, which would re-introduce the editor/export divergence G exists
 *   to remove.
 * - `preferCSSPageSize: true` — the stylesheet's own @page stays the single
 *   source of page geometry rather than a renderer option that can drift.
 *
 * The context is closed in a `finally` so a thrown or timed-out render cannot
 * leak a whole browser context per request.
 *
 * The wall-clock deadline is NOT redundant with the per-call `timeout`
 * options. Measured on 2026-08-25: `page.pdf({ timeout: 300 })` on a
 * CSS-only layout bomb was still running after 15 SECONDS — Playwright does
 * not enforce that option against a Chromium print job that never yields.
 * `setContent` returned in 15ms on the same document, because layout is lazy,
 * so the per-call timeouts protect nothing here. Without the race a single
 * hostile note pins a queue slot for minutes, which defeats the bounded-
 * resource control outright. Closing the context DOES abort the print job
 * (measured at 5ms mid-render), so the `finally` is what actually reclaims
 * the worker.
 */
export async function renderPdf(html: string, deps: RenderDeps = {}): Promise<Uint8Array> {
  const owned = deps.browser === undefined;
  const browser = deps.browser ?? (await sharedBrowser());
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = await browser.newContext({ javaScriptEnabled: false });

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const work = (async () => {
      const page = await context.newPage();
      // Registered before any content exists, so there is no window in which
      // a subresource could be requested unguarded.
      await page.route('**', (route) => route.abort());
      await page.setContent(html, { timeout: timeoutMs, waitUntil: 'load' });
      await page.emulateMedia({ media: 'screen' });
      // `page.pdf()` accepts no `timeout` option (a tsc error, and silently
      // ignored in plain JS), which is the other half of why the wall-clock
      // deadline above is the only thing bounding a print job.
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    })();

    // The losing side of the race keeps running until `context.close()` tears
    // it down, and it will then reject. Absorbed here because an unhandled
    // rejection terminates the Node process.
    work.catch(() => {});

    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => reject(new RenderTimeoutError()), timeoutMs);
    });

    return await Promise.race([work, deadline]);
  } catch (error) {
    if (error instanceof RenderTimeoutError) throw error;
    if (isTimeout(error)) throw new RenderTimeoutError();
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    await closeContext(context, owned);
  }
}
