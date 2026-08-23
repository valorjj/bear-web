import type { Page } from '@playwright/test';

/**
 * Resolves theme tokens to real colours, for a given theme.
 *
 * **Why this cannot just be `getPropertyValue('--bear-muted')`.** A custom
 * property's value is substituted lazily: reading one back gives you the
 * declaration's text, not a computed colour. For a literal that is the same
 * thing, which is why the old approach worked for five hand-written themes.
 * For a derived token it hands you the string
 * `color-mix(in oklab, #e8e8f5 68%, #202030)`, which is not a colour any
 * parser here accepts — `parseColour` would throw or, worse, yield NaN, and
 * `NaN < min` is false, so the contrast harness would report a pass.
 *
 * Painting the value onto a probe element and reading a real CSS property
 * back forces the cascade to resolve it. The result comes back as
 * `color(srgb …)` or `rgb(…)` depending on the notation, both of which
 * `parseColour` understands.
 *
 * The probe is `position: fixed` and zero-sized so it cannot affect layout,
 * and is removed before returning.
 */
export async function readThemeTokens(
  page: Page,
  theme: string,
  names: readonly string[],
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ theme: id, names: tokenNames }) => {
      // Setting the attribute makes the real cascade pick a winner among
      // every theme block and the prefers-color-scheme block — which is the
      // thing being verified.
      document.documentElement.setAttribute('data-theme', id);

      const probe = document.createElement('div');
      probe.style.position = 'fixed';
      probe.style.width = '0';
      probe.style.height = '0';
      probe.style.pointerEvents = 'none';
      document.body.appendChild(probe);

      try {
        return Object.fromEntries(
          tokenNames.map((name) => {
            // Any colour-typed property works; `color` is used because it
            // inherits nothing surprising on a bare probe. Note that the
            // keyword `transparent` resolves to `rgba(0, 0, 0, 0)` here —
            // which is what it means, and is `high-contrast`'s shadow. Every
            // consumer must therefore read tokens through THIS function, or
            // one side will hold the keyword and the other the resolved
            // colour and they will not compare equal.
            probe.style.color = '';
            probe.style.color = `var(--bear-${name})`;
            const painted = getComputedStyle(probe).color;

            // An empty or unset custom property leaves `color` at its
            // inherited value, which would read as a plausible colour rather
            // than as "missing". Fall back to the raw declaration so the
            // caller's own truthiness check can catch it.
            const raw = getComputedStyle(document.documentElement)
              .getPropertyValue(`--bear-${name}`)
              .trim();

            return [name, raw === '' ? '' : painted];
          }),
        ) as Record<string, string>;
      } finally {
        probe.remove();
      }
    },
    { theme, names: [...names] },
  );
}
