import { inflateSync } from 'node:zlib';

/**
 * Enough of a PDF reader to assert what a render actually PAINTED.
 *
 * Test-only, and it exists because every cheaper assertion about a PDF is
 * worthless. `bytes.startsWith('%PDF-')` and `bytes.length > 1000` are true of
 * a blank page; a text extraction is true of white-on-white and of a page of
 * tofu boxes. The two options G's whole "the PDF matches the app exactly"
 * claim rests on — `emulateMedia({ media: 'screen' })` and
 * `preferCSSPageSize: true` in `render.ts` — are invisible to all of them:
 * flip either one and every such assertion still passes.
 *
 * What IS visible in the bytes is the content stream: the fill colours, the
 * rectangles they fill, and where text was positioned. That is what this
 * reads.
 *
 * Deliberately not a PDF library. A dependency here would be a 200 kB parser
 * pulled in to answer three questions, and the interesting failure mode is a
 * library that helpfully normalises away the very difference under test.
 */

/** A colour as it appears in a content stream: components in 0..1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A filled rectangle, in content-stream units (CSS px), with the fill colour in force. */
export interface FilledRect extends Rgb {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfContent {
  /** The first page's `/MediaBox` size, in points. */
  widthPt: number;
  heightPt: number;
  /** Every `re … f` in page order, with the fill colour in force. */
  fills: FilledRect[];
  /** The x/y translation of every text matrix, in content-stream units (CSS px). */
  textOrigins: { x: number; y: number }[];
}

/**
 * Splits out every `stream … endstream` payload.
 *
 * `endstream` also contains the substring `stream`, which is harmless only
 * because the cursor is advanced past the whole terminator each round — the
 * naive version of this loop rescans the tail of `endstream` and yields
 * garbage from that offset onward.
 */
function* rawStreams(bytes: Buffer): Generator<Buffer> {
  // latin1 so one byte is one code unit: every index found here is a byte
  // offset into the buffer, which utf8 would silently break.
  const text = bytes.toString('latin1');
  let cursor = 0;

  for (;;) {
    const found = text.indexOf('stream', cursor);
    if (found < 0) return;

    let start = found + 'stream'.length;
    if (text[start] === '\r') start += 1;
    if (text[start] === '\n') start += 1;

    const end = text.indexOf('endstream', start);
    if (end < 0) return;

    yield bytes.subarray(start, end);
    cursor = end + 'endstream'.length;
  }
}

/**
 * Every stream that inflates, concatenated. Fonts, images and already-plain
 * streams simply throw or decode to noise; a content stream decodes to
 * operators, and that is all this is looking for.
 */
function decodedStreams(bytes: Buffer): string {
  const parts: string[] = [];

  for (const raw of rawStreams(bytes)) {
    try {
      parts.push(inflateSync(raw).toString('latin1'));
    } catch {
      // Not Flate, or truncated. Not a content stream we can read.
    }
  }

  return parts.join('\n');
}

function isNumber(token: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(token);
}

/**
 * Walks the operators, keeping only what the fidelity assertions need.
 *
 * A real interpreter rather than a regex, because the question "what colour
 * is the rectangle that covers the page" is a question about the fill colour
 * *in force* when a particular `re … f` runs — which no single regex can
 * answer without assuming the two sit adjacent, and Skia does not guarantee
 * that.
 *
 * `cm` is deliberately NOT composed, and the consequence is that every number
 * out of here is in the page's own CSS-pixel space rather than in points:
 * Chromium's outermost `cm` is the 0.75 point-per-pixel scale, and it is the
 * same for every page, so leaving it uncomposed is a fixed, documented unit
 * rather than an error. A document using NESTED `cm` scaling would need a real
 * matrix stack — and a glyph drawn in its own space is exactly what produced
 * the `2102 x 3082` rectangle described under `pageBackground`. If one ever
 * matters, the failure is a wrong number rather than a silent pass, because
 * the assertions using this compare against a computed expectation and not
 * against "something".
 */
function walk(content: string): { fills: FilledRect[]; textOrigins: { x: number; y: number }[] } {
  const tokens = content.split(/[\s]+/).filter((token) => token !== '');
  const fills: FilledRect[] = [];
  const textOrigins: { x: number; y: number }[] = [];

  // Starts unknown, not black: a colour op this walker does not recognise
  // (CMYK `k`, a pattern `scn`, a `cs`-scoped space with a different
  // component count) must not be read as an explicit black fill — that made
  // a rectangle covering the page under an unparsed colour report as a
  // passing "dark" background by accident. `f`/`F`/`f*` below only records a
  // fill when the colour was actually parsed.
  let fill: Rgb | null = null;
  let pending: Omit<FilledRect, 'r' | 'g' | 'b'> | null = null;

  const numbersBefore = (index: number, count: number): number[] | null => {
    const out: number[] = [];
    for (let i = index - count; i < index; i += 1) {
      const token = tokens[i];
      if (token === undefined || !isNumber(token)) return null;
      out.push(Number.parseFloat(token));
    }
    return out;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const op = tokens[i]!;

    if (op === 'rg') {
      const values = numbersBefore(i, 3);
      if (values !== null) fill = { r: values[0]!, g: values[1]!, b: values[2]! };
      continue;
    }

    // The general colour-space form. Skia emits `rg` for DeviceRGB in
    // practice, but `sc`/`scn` with three components means the same thing and
    // costs one branch to accept.
    if (op === 'sc' || op === 'scn') {
      const values = numbersBefore(i, 3);
      if (values !== null) fill = { r: values[0]!, g: values[1]!, b: values[2]! };
      continue;
    }

    if (op === 'g') {
      const values = numbersBefore(i, 1);
      if (values !== null) fill = { r: values[0]!, g: values[0]!, b: values[0]! };
      continue;
    }

    if (op === 're') {
      const values = numbersBefore(i, 4);
      if (values !== null) {
        pending = { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! };
      }
      continue;
    }

    // `f`/`F`/`f*` paint the pending rectangle. `re` followed by `W n`
    // (a clip) paints nothing and must not be recorded as a background.
    if (op === 'f' || op === 'F' || op === 'f*') {
      if (pending !== null && fill !== null) fills.push({ ...pending, ...fill });
      pending = null;
      continue;
    }

    if (op === 'Tm') {
      const values = numbersBefore(i, 6);
      if (values !== null) textOrigins.push({ x: values[4]!, y: values[5]! });
      continue;
    }
  }

  return { fills, textOrigins };
}

/** Reads the first `/MediaBox` in the file. */
function mediaBox(bytes: Buffer): { widthPt: number; heightPt: number } {
  const match = /\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/.exec(
    bytes.toString('latin1'),
  );
  if (match === null) return { widthPt: 0, heightPt: 0 };

  return {
    widthPt: Number.parseFloat(match[3]!) - Number.parseFloat(match[1]!),
    heightPt: Number.parseFloat(match[4]!) - Number.parseFloat(match[2]!),
  };
}

export function inspectPdf(bytes: Uint8Array): PdfContent {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const box = mediaBox(buffer);
  const { fills, textOrigins } = walk(decodedStreams(buffer));

  return { ...box, fills, textOrigins };
}

/**
 * The colour of the rectangle covering the page — the page background as the
 * renderer actually painted it.
 *
 * **The content stream is in CSS PIXELS, and its origin is the page CONTENT
 * box.** Both were measured, and both are traps. `/MediaBox` is in points
 * (595 x 842 for A4), but Chromium wraps the page content in a 0.75 scale, so
 * the same A4 page's own background rectangle reads `0 0 673 986` — the
 * content box in pixels, with the `@page` margin already subtracted. Sizing
 * the "does this cover the page" test against `widthPt` therefore compares
 * two different units AND two different boxes; it passed here only by
 * accident of 673 > 595 * 0.95.
 *
 * So the test is not size at all: it is that the fill is ANCHORED AT THE
 * ORIGIN, which the page's own background is and nothing else is. The
 * alternative — a size window — picked up a rect of `2102 x 3082` painted in
 * a glyph's own coordinate space at the document's TEXT colour, and reported
 * a genuinely dark Nord export as luminance 0.86.
 *
 * Among the origin-anchored fills, the largest by area, and the last painted
 * of those — a later rectangle covers an earlier one.
 */
export function pageBackground(content: PdfContent): Rgb | null {
  const anchored = content.fills.filter((rect) => Math.abs(rect.x) <= 1 && Math.abs(rect.y) <= 1);
  if (anchored.length === 0) return null;

  const area = (rect: FilledRect): number => Math.abs(rect.width * rect.height);
  const largest = Math.max(...anchored.map(area));

  return anchored.filter((rect) => area(rect) === largest).at(-1) ?? null;
}

/**
 * Relative luminance, WCAG's formula, on components already in 0..1.
 *
 * Used to say "this page is dark" without pinning a theme's exact hex — the
 * point of the assertion is that the theme reached the paper, not that Nord's
 * background is one particular value.
 */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The leftmost text origin on the page, in the content stream's own units —
 * CSS PIXELS, measured from the page CONTENT box's left edge. See
 * `pageBackground` for why that is not points and not the media box.
 */
export function leftmostTextX(content: PdfContent): number | null {
  if (content.textOrigins.length === 0) return null;
  return Math.min(...content.textOrigins.map((origin) => origin.x));
}
