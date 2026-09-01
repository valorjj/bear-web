/*
 * Runs INSIDE the renderer page, where a real DOM exists.
 *
 * Two hard constraints follow from that, and breaking either fails at runtime
 * rather than at compile time:
 *
 * 1. It may not reference an import, a module-scope binding, or anything in
 *    its enclosing closure. Playwright serializes the function source and
 *    evaluates it in a different realm.
 * 2. It cannot use DOM types from a lib this project does not load. The shapes
 *    it needs are declared below, structurally, exactly as `vitest.setup.ts`
 *    declares its own `MediaQueryList` for the same reason.
 *
 * Why a DOM walk rather than a regex: a regex over markup cannot see nesting,
 * entities or namespaces. `svgGuard.ts` is the regex, and it is a SECOND
 * check, never this one's replacement.
 */

declare const DOMParser: new () => {
  parseFromString(markup: string, type: string): { documentElement: unknown };
};
declare const XMLSerializer: new () => { serializeToString(node: unknown): string };

interface MinimalAttr {
  readonly name: string;
  readonly value: string;
}

interface MinimalElement {
  readonly tagName: string;
  readonly attributes: ArrayLike<MinimalAttr>;
  readonly children: ArrayLike<MinimalElement>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
}

/**
 * Removes every construct the guard refuses, and returns the surviving
 * markup. Takes and returns strings so it can cross the realm boundary.
 */
export function sanitizeInPage(markup: string): string {
  // `set`, `animateTransform` and `animateMotion` are as capable as `animate`
  // of driving `href`/`xlink:href` to an attacker-chosen value over time —
  // proven with `<set attributeName="href" to="javascript:alert(1)"/>`, which
  // survives both this pass and `svgGuard.ts`'s regex if left off this list.
  // Not currently reachable (it needs an `<a>` parent, which is itself
  // stripped below) and Mermaid emits none of the four, but the cost of
  // listing all four is one line against a proven two-layer bypass.
  const FORBIDDEN_TAGS = new Set([
    'script',
    'foreignobject',
    'use',
    'a',
    'image',
    'animate',
    'set',
    'animatetransform',
    'animatemotion',
  ]);

  const parser = new DOMParser();
  const parsed = parser.parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement as unknown as MinimalElement;

  // A parse failure does not throw: `DOMParser` recovers instead, and it
  // recovers TWO different ways depending on how broken the markup is —
  // both proven, neither raises an exception on its own, and neither is
  // anything `findUnsafeSvgConstructs` has a rule against, so either would
  // sail through as "sanitized" markup.
  //
  // 1. Badly-broken input (empty string, non-XML text) replaces the root
  //    entirely — with `<html>`, not `<svg>` — caught by the tagName check
  //    below.
  // 2. Input that is malformed but still SVG-shaped, e.g. `<svg><g></svg>`
  //    (a real Mermaid bug would look like this, not like an XSS attempt),
  //    recovers with the root STILL named `svg` but a `<parsererror>`
  //    element spliced in as a CHILD — the tagName check alone misses this,
  //    so it is checked for explicitly too.
  //
  // Since Mermaid itself only ever hands this function markup it just
  // produced, either shape means something went wrong upstream, and this is
  // the one place positioned to catch it before the guard even runs.
  if (root.tagName.toLowerCase() !== 'svg') {
    throw new Error(`sanitizeInPage: expected an <svg> root, got <${root.tagName}>`);
  }
  const rootWithQuery = root as unknown as { querySelector(selector: string): unknown };
  if (rootWithQuery.querySelector('parsererror') !== null) {
    throw new Error('sanitizeInPage: markup contains a parser error');
  }

  // Mermaid emits `width="100%"` on the root `<svg>` PLUS an inline
  // `style="max-width: Npx"` — the pixel value of the diagram's true,
  // unscaled size. An inline declaration always wins over any external
  // stylesheet rule regardless of specificity, so pairing that inline
  // `max-width` with a percentage `width` and no CSS `width` of its own
  // leaves the rendered size to a replaced-element auto-sizing algorithm
  // that resolves differently depending on the ancestor chain — measured
  // directly: a small diagram (`max-width: 111px`) dropped into a WIDE flex
  // ancestor with only its own `max-width` set and no `width` (exactly the
  // shape of `.ProseMirror` in `editor.css`, which has `max-width` but no
  // fixed `width` on ITS OWN ancestor) rendered at 1500px instead of its
  // natural 111px once the inline `max-width` was removed outright — a
  // massive stretch, not a shrink. Simply deleting the inline style is
  // therefore wrong.
  //
  // Rewritten to the standard responsive-SVG pattern instead: concrete
  // `width`/`height` attributes taken from `viewBox` (which already carries
  // the diagram's true intrinsic size and aspect ratio) replace the
  // percentage `width`, and the inline `style` is dropped entirely. With a
  // concrete intrinsic size, the client's own
  // `.bear-mermaid__figure svg { max-width: 100%; height: auto }` is the
  // ONLY thing left governing how the SVG scales — a small diagram keeps
  // its natural size (nothing forces it to fill 100% of anything), and a
  // wide one is capped at the column's width exactly as intended. No
  // reliance on the ambiguous auto-sizing algorithm at all.
  const viewBox = root.getAttribute('viewBox');
  if (viewBox !== null) {
    const parts = viewBox.trim().split(/\s+/);
    if (parts.length === 4) {
      root.setAttribute('width', parts[2]!);
      root.setAttribute('height', parts[3]!);
    }
  }
  root.removeAttribute('style');

  const visit = (element: MinimalElement): void => {
    // Snapshot first: removing while iterating a live collection skips nodes.
    const children = Array.from(element.children);

    const tag = element.tagName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      // `use` and `a` are removed rather than unwrapped. Mermaid emits neither
      // in the diagram types this ships with (`htmlLabels: false` is what
      // keeps `foreignObject` out), so dropping them costs nothing real and
      // avoids reasoning about what an unwrapped subtree can still reference.
      element.remove();
      return;
    }

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }

      if ((name === 'href' || name.endsWith(':href')) && !value.startsWith('#')) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (name === 'style' && /url\(\s*["']?(?!#)|@import|expression\(/i.test(value)) {
        element.removeAttribute(attr.name);
        continue;
      }
    }

    for (const child of children) visit(child);
  };

  visit(root);

  // The `<style>` element Mermaid emits carries our own theme CSS plus its
  // own base rules. Its TEXT is not an attribute, so the attribute pass above
  // cannot see an @import inside it: handled here, and by dropping the whole
  // element rather than editing CSS with a regex.
  for (const style of Array.from(
    (
      parsed.documentElement as unknown as {
        querySelectorAll(s: string): ArrayLike<MinimalElement>;
      }
    ).querySelectorAll('style'),
  )) {
    const text = (style as unknown as { textContent: string | null }).textContent ?? '';
    if (/@import|url\(\s*["']?(?!#)|expression\(/i.test(text)) style.remove();
  }

  return new XMLSerializer().serializeToString(parsed);
}
