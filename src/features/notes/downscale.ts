/** A mis-paste guard, not a storage budget: the downscale runs after it. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Long edge. A 2048px WebP is sharp on every display this app runs on. */
export const MAX_EDGE_PX = 2048;

export const WEBP_QUALITY = 0.8;

export interface DownscaledImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface DownscaleDeps {
  createBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  encode?: (bitmap: unknown, width: number, height: number) => Promise<Blob>;
}

function fit(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE_PX) return { width, height };
  const scale = MAX_EDGE_PX / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * One WebP per image, at most `MAX_EDGE_PX` on its long edge.
 *
 * `null` rather than a throw for the two refusals: an oversized paste and a
 * non-image are both ordinary things a user does, and the caller's answer to
 * each is to fall through to the default paste rather than to handle an error.
 *
 * An image already small enough is still RE-ENCODED, so exactly one format is
 * ever stored and every downstream path — the node view, K2's upload, K3's
 * export — has one case to handle rather than "whatever was pasted".
 *
 * The two browser calls are INJECTED because jsdom implements neither
 * `createImageBitmap` nor `OffscreenCanvas`. The unit tests cover the
 * arithmetic and the refusals, which is where the bugs are; the real encode is
 * exercised in Playwright, which is the only place a genuine WebP is produced.
 */
export async function downscaleImage(
  file: Blob,
  deps: DownscaleDeps = {},
): Promise<DownscaledImage | null> {
  // Duck-typed, never `instanceof`: `vitest.setup.ts` swaps the global `Blob`
  // for Node's, so `instanceof Blob` is false under test and true in a browser.
  if (!file.type.startsWith('image/')) return null;

  // Checked BEFORE decoding. Decoding a 30MB paste to find out it is too big
  // is the part that would freeze the tab.
  if (file.size > MAX_SOURCE_BYTES) return null;

  const createBitmap = deps.createBitmap ?? ((blob: Blob) => createImageBitmap(blob));
  const encode =
    deps.encode ??
    (async (bitmap: unknown, width: number, height: number): Promise<Blob> => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context');
      context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
      return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    });

  const bitmap = await createBitmap(file);
  try {
    const size = fit(bitmap.width, bitmap.height);
    const blob = await encode(bitmap, size.width, size.height);
    return { blob, width: size.width, height: size.height };
  } finally {
    bitmap.close?.();
  }
}
