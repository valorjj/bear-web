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
  removeAttribute(name: string): void;
  remove(): void;
  getAttribute(name: string): string | null;
}

/**
 * Removes every construct the guard refuses, and returns the surviving
 * markup. Takes and returns strings so it can cross the realm boundary.
 */
export function sanitizeInPage(markup: string): string {
  const FORBIDDEN_TAGS = new Set(['script', 'foreignobject', 'use', 'a', 'image', 'animate']);

  const parser = new DOMParser();
  const parsed = parser.parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement as unknown as MinimalElement;

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
