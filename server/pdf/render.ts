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

export async function sharedBrowser(): Promise<Browser> {
  shared ??= await chromium.launch();
  return shared;
}

export async function closeSharedBrowser(): Promise<void> {
  const browser = shared;
  shared = null;
  await browser?.close();
}

/**
 * Playwright signals its own timeouts with `TimeoutError`, whose message is
 * locale-independent but whose shape is not guaranteed across versions. Both
 * the name and the message are checked, because matching on the message alone
 * would silently reclassify a timeout as a 500 the day the wording changes,
 * and matching on the name alone would miss a timeout re-thrown by a wrapper.
 */
function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || /timeout/i.test(error.message);
}

/**
 * Bounded, because a close that hangs would pin the very worker the deadline
 * below exists to reclaim. A context that outlives this is left for the
 * periodic browser restart in `queue.ts` to reap.
 */
const CLOSE_TIMEOUT_MS = 5_000;

async function closeContext(context: BrowserContext): Promise<void> {
  await Promise.race([
    context.close().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
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
    await closeContext(context);
  }
}
