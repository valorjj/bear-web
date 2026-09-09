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
  /**
   * A class to mount the probe INSIDE, so tokens re-mapped on that scope
   * resolve the way they do in the app.
   *
   * `bear-sidebar-scope` is the case this exists for: the light indigo themes
   * paint a DARK sidebar and re-map `text`, `muted`, `faint`, `border`,
   * `hover` and `selected` on that container. Reading them at the root would
   * compare the light theme's near-black `text` against a near-black
   * `sidebar` and report 1.00 — a failure that is not real, because nothing
   * paints that pair.
   */
  scopeClass?: string,
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ theme: id, names: tokenNames, scope }) => {
      // Setting the attribute makes the real cascade pick a winner among
      // every theme block and the prefers-color-scheme block — which is the
      // thing being verified.
      document.documentElement.setAttribute('data-theme', id);

      // The probe hangs inside a host so a scope class can be applied
      // WITHOUT putting it on the probe itself — a scope that re-maps tokens
      // must be an ANCESTOR for inheritance to do the work, exactly as the
      // real sidebar container is an ancestor of its rows.
      const host = document.createElement('div');
      if (scope !== '') host.className = scope;
      host.style.position = 'fixed';
      host.style.width = '0';
      host.style.height = '0';
      host.style.pointerEvents = 'none';

      const probe = document.createElement('div');
      host.appendChild(probe);
      document.body.appendChild(host);

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
            // Read from the PROBE, not from the root: a custom property
            // inherits, so this sees a scope's re-mapped declaration as well
            // as the root's. Reading the root would miss a token that only a
            // scope defines and report it as missing.
            const raw = getComputedStyle(probe).getPropertyValue(`--bear-${name}`).trim();

            return [name, raw === '' ? '' : painted];
          }),
        ) as Record<string, string>;
      } finally {
        host.remove();
      }
    },
    { theme, names: [...names], scope: scopeClass ?? '' },
  );
}
