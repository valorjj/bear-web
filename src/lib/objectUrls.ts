interface Entry {
  url: string;
  count: number;
}

/**
 * One object URL per stored file, reference-counted.
 *
 * In `src/lib/` because it is behaviour with no product knowledge: it takes a
 * loader and knows nothing about notes, files or the editor. Both the editor's
 * stored-image node and the note-list row's thumbnail use it, and a second
 * copy would be a second place to leak.
 *
 * Module scope deliberately. A node view is destroyed and rebuilt whenever
 * ProseMirror redraws its node, so a per-instance URL would be created and
 * leaked on every redraw — and creating one per render is the obvious
 * implementation. A note scrolled on a phone would accumulate them for the
 * life of the tab, and nothing in the app, the test suite or the browser would
 * report it. `objectUrls.test.ts` spies on `revokeObjectURL` because that spy
 * is the only thing that can see a leak.
 */
const entries = new Map<string, Entry>();

/** In-flight loads, so two views mounting in the same tick read the blob once. */
const pending = new Map<string, Promise<string | null>>();

export async function acquireObjectUrl(
  id: string,
  load: (id: string) => Promise<Blob | null>,
): Promise<string | null> {
  const existing = entries.get(id);
  if (existing !== undefined) {
    existing.count += 1;
    return existing.url;
  }

  const inFlight = pending.get(id);
  if (inFlight !== undefined) return inFlight;

  const promise = (async (): Promise<string | null> => {
    const blob = await load(id);
    // A miss is NOT cached. The bytes can arrive later — that is exactly what
    // K2's sync does — and a cached miss would leave the placeholder on screen
    // for the life of the tab with no way to retry.
    if (blob === null) return null;

    const cached = entries.get(id);
    if (cached !== undefined) {
      cached.count += 1;
      return cached.url;
    }

    const url = URL.createObjectURL(blob);
    entries.set(id, { url, count: 1 });
    return url;
  })().finally(() => pending.delete(id));

  pending.set(id, promise);
  return promise;
}

export function releaseObjectUrl(id: string): void {
  const entry = entries.get(id);
  if (entry === undefined) return;

  entry.count -= 1;
  if (entry.count > 0) return;

  URL.revokeObjectURL(entry.url);
  entries.delete(id);
}
