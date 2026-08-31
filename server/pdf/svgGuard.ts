/**
 * A cheap, INDEPENDENT check that a piece of SVG markup carries none of the
 * constructs the in-page sanitizer removes.
 *
 * This is deliberately not a sanitizer and must never be used as one — a
 * regex over markup cannot understand nesting, entities or namespaces, which
 * is exactly why the real removal happens against a real DOM inside the
 * renderer's page (`sanitizeInPage.ts`).
 *
 * What this buys is the thing a sanitizer alone cannot: a SECOND check, in a
 * different process, written against the same list. The in-page sanitizer runs
 * in a page where Mermaid — third-party code, driven by user input — has just
 * executed. If it were silently defeated or accidentally disabled, the only
 * thing standing between that page and an SVG inlined into the notes app's own
 * DOM would be this function. It errs toward false positives; a false positive
 * is a 500 and a diagram that does not render, which is recoverable, and a
 * false negative is script in the user's notes, which is not.
 *
 * It is also run at the API boundary (`server/src/routes/diagram.ts`), so a
 * mis-deployed or replaced renderer container cannot ship markup past it.
 */
export type UnsafeConstruct =
  'script' | 'eventHandler' | 'foreignObject' | 'externalReference' | 'cssImport' | 'cssUrl';

/**
 * A `url(...)` or `href` target that is NOT a same-document fragment.
 *
 * Mermaid legitimately uses `url(#arrow-head)` for markers and `#id` for
 * internal references, so a blanket ban would reject every real diagram.
 * Anything else — absolute, protocol-relative, `javascript:`, or a bare
 * relative path — is refused.
 */
const EXTERNAL_HREF = /\b(?:xlink:href|href)\s*=\s*(?:["'](?!#)[^"']*["']|(?!#)(?!["'])[^\s/>]*)/i;
const EXTERNAL_URL_FN = /url\(\s*(?!["']?\s*#)/i;

export function findUnsafeSvgConstructs(markup: string): UnsafeConstruct[] {
  const found: UnsafeConstruct[] = [];

  if (/<\s*script\b/i.test(markup)) found.push('script');
  // Any attribute whose name starts with `on`, however quoted. `[\s/]on` rather
  // than `on` so `font-family="...on..."` is not a hit; includes `/` separator
  // which lenient parsers treat as whitespace.
  if (/[\s/]on[a-z]+\s*=/i.test(markup)) found.push('eventHandler');
  if (/<\s*foreignObject\b/i.test(markup)) found.push('foreignObject');
  if (EXTERNAL_HREF.test(markup)) found.push('externalReference');
  if (/@import\b/i.test(markup)) found.push('cssImport');
  if (EXTERNAL_URL_FN.test(markup)) found.push('cssUrl');

  return found;
}
