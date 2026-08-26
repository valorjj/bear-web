import { describe, expect, it, vi } from 'vitest';

import { downscaleImage, MAX_EDGE_PX, MAX_SOURCE_BYTES } from './downscale';

/**
 * A fake bitmap and encoder. jsdom implements neither `createImageBitmap` nor
 * `OffscreenCanvas`, which is why `downscaleImage` takes both as dependencies
 * — and why the real encode is covered in Playwright rather than here.
 */
function deps(source: { width: number; height: number }) {
  const encode = vi.fn(
    async (_bitmap: unknown, width: number, height: number) =>
      new Blob([new Uint8Array(Math.max(1, Math.round(width * height * 0.01)))], {
        type: 'image/webp',
      }),
  );
  const close = vi.fn();
  return {
    encode,
    close,
    createBitmap: async () => ({ ...source, close }),
  };
}

function imageBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

describe('downscaleImage', () => {
  it('caps the long edge and preserves the aspect ratio', async () => {
    const d = deps({ width: 4000, height: 2000 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result).not.toBeNull();
    expect(result!.width).toBe(MAX_EDGE_PX);
    expect(result!.height).toBe(MAX_EDGE_PX / 2);
  });

  it('caps the long edge when the image is portrait', async () => {
    const d = deps({ width: 1000, height: 5000 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result!.height).toBe(MAX_EDGE_PX);
    expect(result!.width).toBe(Math.round(MAX_EDGE_PX / 5));
  });

  it('never UPSCALES a small image', async () => {
    const d = deps({ width: 300, height: 200 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result!.width).toBe(300);
    expect(result!.height).toBe(200);
  });

  it('re-encodes even an image that needs no resizing', async () => {
    // Exactly one stored format means exactly one case for every downstream
    // path — the node view, K2's upload, K3's export.
    const d = deps({ width: 300, height: 200 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result!.blob.type).toBe('image/webp');
    expect(d.encode).toHaveBeenCalledTimes(1);
  });

  it('releases the decoded bitmap, which is the largest thing it allocates', async () => {
    const d = deps({ width: 4000, height: 2000 });

    await downscaleImage(imageBlob(), d);

    expect(d.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a file over the source limit WITHOUT decoding it', async () => {
    const d = deps({ width: 100, height: 100 });
    const huge = new Blob([new Uint8Array(10)], { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: MAX_SOURCE_BYTES + 1 });

    expect(await downscaleImage(huge, d)).toBeNull();
    // Not merely "returns null": decoding a 30MB paste before rejecting it is
    // the part that would freeze the tab, so the order is the contract.
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('rejects a non-image', async () => {
    const d = deps({ width: 100, height: 100 });

    expect(await downscaleImage(new Blob(['x'], { type: 'text/plain' }), d)).toBeNull();
    expect(d.encode).not.toHaveBeenCalled();
  });
});
