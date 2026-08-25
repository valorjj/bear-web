import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderPdf, RenderTimeoutError } from './render.ts';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => browser?.close());

const latin1 = (pdf: Uint8Array): string => Buffer.from(pdf).toString('latin1');

/**
 * Chromium writes the page tree's `/Count` uncompressed, so the number of
 * pages is readable from the bytes without a PDF parser. This is the only
 * property of a rendered document that is both externally observable and
 * driven by content the test controls, which is what makes the
 * script-execution assertion below able to fail.
 */
function pageCount(pdf: Uint8Array): number {
  const match = /\/Count\s+(\d+)/.exec(latin1(pdf));
  if (!match) throw new Error('no /Count in the PDF — the extraction assumption broke');
  return Number(match[1]);
}

/** The concrete faces Chromium embedded, e.g. `BAAAAA+Helvetica`. */
function embeddedFonts(pdf: Uint8Array): string[] {
  return [
    ...new Set([...latin1(pdf).matchAll(/\/BaseFont\s*\/([A-Za-z0-9+_.-]+)/g)].map((m) => m[1]!)),
  ];
}

describe('renderPdf', () => {
  it('produces a PDF', async () => {
    const pdf = await renderPdf('<h1>hello</h1>', { browser });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('NEVER fetches a subresource, however the HTML asks (SSRF)', async () => {
    // The single most important test here. The renderer is handed arbitrary
    // HTML by an authenticated client and drives a real browser inside the
    // network; one un-aborted request is an internal port scanner.
    const hits: string[] = [];
    const listener: Server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('x');
    });
    await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
    const port = (listener.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    await renderPdf(
      `<img src="${base}/img">
       <link rel="stylesheet" href="${base}/css">
       <iframe src="${base}/frame"></iframe>
       <style>@font-face{font-family:x;src:url(${base}/font)}</style>
       <body style="font-family:x">force the face to be needed</body>`,
      { browser },
    );

    // A request the abort merely DELAYED rather than stopped would land after
    // page.pdf() resolved. Without this settle the test would pass on a
    // renderer that only appeared to block.
    await new Promise((r) => setTimeout(r, 250));
    await new Promise<void>((r) => listener.close(() => r()));
    expect(hits).toEqual([]);
  });

  it('does not execute script', async () => {
    // NOT a document.title assertion. `page.pdf()` writes no /Title at all,
    // so a title-based test passes whether or not the script ran — verified
    // empirically before this was written. Page count is driven by layout,
    // which a script CAN change and which the PDF DOES record.
    const hostile = `<body><div id="x">tiny</div><script>document.getElementById('x').style.height='6000px'</script></body>`;

    const pdf = await renderPdf(hostile, { browser });

    // With JS enabled this same document renders 6 pages.
    expect(pageCount(pdf)).toBe(1);
  });

  it('times out rather than pinning a worker, and the next render still works', async () => {
    // A CSS-only layout bomb: no script needed, so this survives
    // javaScriptEnabled: false. It defeats the per-call `timeout` options
    // entirely — `setContent` returns in ~15ms because layout is lazy, and
    // `page.pdf()` takes no timeout option at all — so what is under test is
    // the wall-clock deadline, and nothing else.
    const hostile = '<div style="height:100000px">x</div>'.repeat(4_000);

    const started = Date.now();
    await expect(renderPdf(hostile, { browser, timeoutMs: 500 })).rejects.toBeInstanceOf(
      RenderTimeoutError,
    );
    const elapsed = Date.now() - started;

    // Rejecting EVENTUALLY is not the control; rejecting PROMPTLY is. Measured
    // without the deadline, this same document was still rendering after 15
    // seconds, so a test that only checked the error type passed a renderer
    // that pinned its worker for minutes.
    expect(elapsed).toBeLessThan(5_000);

    const after = await renderPdf('<p>still alive</p>', { browser });
    expect(Buffer.from(after.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('carries the requested font family through to the embedded faces', async () => {
    // The mechanism the Pretendard control depends on: a family named in CSS
    // must reach Chromium's font selection and appear in the PDF's font
    // resources. Asserting that two different requested families produce two
    // different embedded faces is host-independent and still fails if font
    // selection is ignored — unlike naming a face that only the container has.
    const serif = await renderPdf(`<body style="font-family:serif">Aa</body>`, { browser });
    const mono = await renderPdf(`<body style="font-family:monospace">Aa</body>`, { browser });

    expect(embeddedFonts(serif)).not.toEqual([]);
    expect(embeddedFonts(serif)).not.toEqual(embeddedFonts(mono));
  });

  /*
   * There is deliberately NO Korean-font test here.
   *
   * The face is a property of the IMAGE, not of this module, and the two
   * env-gated cases that used to sit here were skipped on every run — which
   * reads as coverage and is not. The assertion lives in the build instead:
   * `server/docker/pdf/verify-fonts.mjs` renders both families and the image
   * FAILS TO BUILD if either is not embedded. It caught a real defect on
   * 2026-08-25 (JetBrains Mono resolving to WenQuanYiZenHeiMono), which is
   * more than a skipped test would ever have done.
   *
   * A fontconfig-level check would not have caught it either: `fc-match`
   * answered correctly while Chromium ignored the alias. Only a render sees
   * this, and a text-extraction assertion would not see it even then — a
   * missing glyph still extracts as its codepoint, so tofu is invisible to
   * text extraction. Hence the check on the embedded font resources.
   */
});
