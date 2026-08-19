import { describe, expect, it, vi } from 'vitest';

import { printHtmlDocument } from './print';

const html = '<!doctype html><html><body><p>hello</p></body></html>';

describe('printHtmlDocument', () => {
  it('prints a frame carrying the supplied document, then removes it', async () => {
    const seen: { srcdoc: string; attached: boolean }[] = [];

    await printHtmlDocument(html, {
      print: (frame) => {
        seen.push({ srcdoc: frame.srcdoc, attached: frame.isConnected });
      },
    });

    expect(seen).toHaveLength(1);
    // The frame must still be in the document when printing happens — a
    // detached frame prints blank.
    expect(seen[0]?.attached).toBe(true);
    expect(seen[0]?.srcdoc).toBe(html);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('removes the frame even when printing throws', async () => {
    // `window.print` can throw — jsdom does exactly this, and so does a
    // sandboxed frame. A frame left behind holds a second document alive, and
    // one per export accumulates with nothing on screen to show it.
    await expect(
      printHtmlDocument(html, {
        print: () => {
          throw new Error('not implemented');
        },
      }),
    ).rejects.toThrow('not implemented');

    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('waits for the frame to load before printing', async () => {
    const order: string[] = [];
    const realAdd = HTMLIFrameElement.prototype.addEventListener;

    // Defer the load event by a macrotask, so a version that printed
    // synchronously after append would record "print" first.
    vi.spyOn(HTMLIFrameElement.prototype, 'addEventListener').mockImplementation(function mocked(
      this: HTMLIFrameElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type === 'load') {
        setTimeout(() => {
          order.push('load');
          (listener as EventListener)(new Event('load'));
        }, 0);
        return;
      }
      realAdd.call(this, type, listener, options);
    });

    try {
      await printHtmlDocument(html, { print: () => void order.push('print') });
    } finally {
      vi.restoreAllMocks();
    }

    expect(order).toEqual(['load', 'print']);
  });
});
