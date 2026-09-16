import { storedImageId } from '@/data';

/**
 * The longest note this will import.
 *
 * The payload is bytes from outside the app, so it is bounded before it can
 * reach IndexedDB. One million characters is far past any note a person
 * writes and far short of anything that makes the browser struggle.
 */
const MAX_TEXT = 1_000_000;

/**
 * The longest title this will accept.
 *
 * `text` was already bounded; `title` was only shape-checked. `ImportSheet`
 * renders it directly into a `<p>` in an unconstrained-width `Dialog`, so an
 * attacker-chosen 200,000-character title would push the sheet's own Cancel
 * button off-screen — a layout defect with a security-shaped cause. A few
 * hundred characters is far past any real note title; `line-clamp-2` in
 * `ImportSheet` is the belt to this cap's braces.
 */
const MAX_TITLE = 500;

export interface SharedImage {
  /** The `files/<id>.webp` path exactly as it appears in `text`. */
  path: string;
  blob: Blob;
}

export interface SharedPayload {
  title: string;
  text: string;
  images: SharedImage[];
  /** Images whose bytes could not be read. Reported to the user, never hidden. */
  skipped: number;
}

/** `data:<mime>;base64,<payload>` — the only form the exporter writes. */
const DATA_URI = /^data:([^;,]+);base64,(.*)$/s;

function decodeDataUri(uri: string): Blob | null {
  const match = DATA_URI.exec(uri);
  if (match === null) return null;

  try {
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1]! });
  } catch {
    // `atob` throws on a payload that is not base64. A corrupt image is a
    // skipped image, never a failed import.
    return null;
  }
}

/**
 * The importable payload inside a published or exported document, or `null`.
 *
 * Pure: a string in, a value out. It owns no DOM, touches no database, and
 * makes no request — which is what lets every branch below be a cheap unit
 * test, and every branch below is a real input rather than a hypothetical.
 *
 * `null` means "this document is not importable", and the most common reason
 * is the most boring one: it was published before sub-project W shipped and
 * carries no payload at all. Absence is the signal; nothing migrates and
 * there is no version marker to check.
 *
 * An image is matched to its place in the text by `data-src`, which the
 * exporter keeps for exactly this purpose. An `<img>` without one is not an
 * image this app stored — it is a remote URL the author wrote, which stays in
 * the text as a remote URL and is not ours to import.
 *
 * An image WITH a `data-src` whose bytes cannot be read is COUNTED, not
 * dropped: `skipped` reaches the confirmation sheet, because a note that
 * quietly loses a picture is worse than one that says it did.
 */
export function parseSharedPage(html: string): SharedPayload | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const block = doc.getElementById('bear-source');
  if (block === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.textContent ?? '');
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const { title, text } = parsed as Record<string, unknown>;
  if (typeof title !== 'string' || typeof text !== 'string') return null;
  if (text.length > MAX_TEXT || title.length > MAX_TITLE) return null;

  const images: SharedImage[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const element of doc.querySelectorAll('img[data-src]')) {
    const path = element.getAttribute('data-src') ?? '';
    // Anything that is not `files/<id>.webp` is not a path this app wrote,
    // and it is about to become part of a note's text.
    if (storedImageId(path) === null) {
      skipped += 1;
      continue;
    }
    if (seen.has(path)) continue;

    const blob = decodeDataUri(element.getAttribute('src') ?? '');
    if (blob === null) {
      skipped += 1;
      continue;
    }

    seen.add(path);
    images.push({ path, blob });
  }

  return { title, text, images, skipped };
}
