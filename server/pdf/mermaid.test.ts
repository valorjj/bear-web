import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MERMAID_VERSION, MermaidSyntaxError, renderMermaid } from './mermaid.ts';
import { findUnsafeSvgConstructs } from './svgGuard.ts';

/*
 * `page.evaluate` callbacks below run inside the BROWSER page, where a real
 * DOM exists — same situation as `sanitizeInPage.ts`, and the same fix:
 * `tsconfig.server.json` has no DOM lib, so these names are declared
 * locally, structurally, rather than widening the project's lib for a test
 * file. Minimal on purpose — just enough shape for what these callbacks use.
 */
interface MinimalDomElement {
  readonly textContent: string | null;
  readonly children: ArrayLike<MinimalDomElement>;
}
interface MinimalHostElement {
  readonly style: { setProperty(name: string, value: string): void };
  innerHTML: string;
  querySelector(selector: string): MinimalDomElement | null;
  querySelectorAll(selector: string): ArrayLike<MinimalDomElement>;
}
declare const document: {
  createElement(tagName: string): MinimalHostElement;
  readonly body: { appendChild(node: unknown): void };
};
declare function getComputedStyle(el: unknown): { readonly fill: string };

/**
 * Mermaid is deliberately NOT a host dependency (see the Dockerfile comment
 * and CLAUDE.md's global constraint) — it is resolved at call time inside
 * `renderMermaid`, exactly like the Dockerfile installs it inside the image
 * and nowhere else. On the host it only exists when something installed it
 * for this run: CI's "Install Mermaid for renderer tests" step, or a
 * developer's temporary `npm install --no-save mermaid@…`.
 */
function mermaidAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
    return true;
  } catch {
    return false;
  }
}

const available = mermaidAvailable();

describe('the mermaid suite is not silently skipped', () => {
  it('has mermaid installed whenever CI is set', () => {
    // The failure this prevents: CI reports green because every mermaid test
    // skipped for want of the package. `migrate.test.ts` guards
    // `TEST_DATABASE_URL` the same way, for the same reason — "exists,
    // unrun, silently stale" is this repo's stated worst failure mode.
    // Locally, with CI unset, this runs no assertion at all — that is the
    // honest description of a CI-only guard, not a defect to paper over.
    if (process.env.CI) {
      expect(available, 'CI must install mermaid before `npm run test:pdf`').toBe(true);
    }
  });
});

describe('MERMAID_VERSION matches the pinned Dockerfile version', () => {
  it('does not drift from server/docker/pdf/Dockerfile', () => {
    // Needs neither Chromium nor mermaid on the host: it only reads text.
    // Runs unconditionally so a version bump in one place without the other
    // fails immediately, rather than waiting to be noticed as a class-name
    // mismatch the way `mermaidTheme.ts`'s corrections were found.
    const dockerfilePath = fileURLToPath(new URL('../docker/pdf/Dockerfile', import.meta.url));
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const match = /npm install --no-save --omit=dev[^\n]*\bmermaid@([\d.]+)/.exec(dockerfile);

    expect(match, 'Dockerfile must pin mermaid@<version> on its npm install line').not.toBeNull();
    expect(match?.[1]).toBe(MERMAID_VERSION);
  });
});

describe.skipIf(!available)('renderMermaid', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
  });

  it('renders a flowchart to SVG', async () => {
    const svg = await renderMermaid('flowchart TD\n  A[Start] --> B[End]', { browser });

    expect(svg).toContain('<svg');
    // The LABELS, not merely the element: a render that produced an empty
    // frame would satisfy `<svg` and nothing else.
    expect(svg).toContain('Start');
    expect(svg).toContain('End');
  }, 30_000);

  it('emits text labels, never foreignObject', async () => {
    // `htmlLabels: false` is what makes the sanitizer's foreignObject rule
    // costless. If a Mermaid upgrade changes that default back, this fails
    // here rather than showing up as a diagram with no labels in the app.
    const svg = await renderMermaid('flowchart TD\n  A[Label text] --> B[Other]', { browser });

    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('<text');
  }, 30_000);

  /**
   * Paints the `--bear-*` tokens onto a real host element, inlines the
   * rendered SVG into it, and reads back a COMPUTED style on the DEEPEST
   * leaf element containing the target text — never a `class`, a substring
   * of the markup, or an ancestor `<text>`/`<tspan>` that merely CONTAINS
   * the glyph-bearing node.
   *
   * That last distinction is not decoration. `toContain('var(--bear-text)')`
   * used to stand in for a computed-style check entirely and passed
   * throughout a real bug (`fill` present in the stylesheet, never applied).
   * The FIRST fix for that — reading back `getComputedStyle` on whichever
   * `text`/`tspan` matched first in document order — still passed a SECOND,
   * narrower bug: Mermaid nests an actor's name, a note's text and a loop's
   * condition text inside a child `<tspan>` that IT styles directly
   * (`#d text.actor > tspan`, `#d .noteText > tspan`,
   * `#d .loopText > tspan`), so the outer `<text>` element resolves
   * correctly (nothing there overrides inheritance) while the actual
   * glyphs, one level down, do not. A `.find()` over `querySelectorAll`
   * returns elements in DOCUMENT order — parent before child — so it
   * always found that outer `<text>` first and never noticed. Filtering to
   * elements with NO element children (true leaves) instead means the
   * assertion is on the node that actually paints the pixels, regardless of
   * how many tspan levels Mermaid wraps a label in.
   */
  async function computedFillForText(svg: string, text: string): Promise<string | null> {
    const page = await browser.newPage();
    try {
      return await page.evaluate(
        ({ svg, text }) => {
          const host = document.createElement('div');
          host.style.setProperty('--bear-text', 'rgb(0, 255, 0)');
          host.style.setProperty('--bear-surface', 'rgb(10, 10, 10)');
          host.style.setProperty('--bear-border', 'rgb(20, 20, 20)');
          host.style.setProperty('--bear-muted', 'rgb(30, 30, 30)');
          host.style.setProperty('--bear-bg', 'rgb(40, 40, 40)');
          host.innerHTML = svg;
          document.body.appendChild(host);
          const leaves = Array.from(host.querySelectorAll('*')).filter(
            (el) => el.children.length === 0 && el.textContent?.includes(text),
          );
          // The LAST leaf in document order is the innermost match when a
          // label is wrapped in nested tspans (text-outer-tspan >
          // text-inner-tspan) — both are leaves-with-matching-text if the
          // outer one has no OTHER element children, so document order
          // (innermost written last in a depth-first walk's leaf set here)
          // picks the deepest.
          const target = leaves[leaves.length - 1] ?? null;
          return target ? getComputedStyle(target).fill : null;
        },
        { svg, text },
      );
    } finally {
      await page.close();
    }
  }

  it('paints a flowchart node label with the theme text colour', async () => {
    const svg = await renderMermaid('flowchart TD\n  A[NodeLabelXyz] --> B[OtherXyz]', {
      browser,
    });

    const fill = await computedFillForText(svg, 'NodeLabelXyz');

    expect(fill).toBe('rgb(0, 255, 0)');
  }, 30_000);

  it('paints a sequence actor name with the theme text colour', async () => {
    // The actor's name is drawn twice (top and bottom box) — either match is
    // fine, `computedFillForText` just needs the glyph-bearing leaf, which
    // for an actor name is a `<tspan>` Mermaid styles directly
    // (`#d text.actor > tspan`), not the `<text class="actor actor-box">`
    // wrapping it.
    const svg = await renderMermaid('sequenceDiagram\n  participant Alice\n  Alice->>Bob: hi', {
      browser,
    });

    const fill = await computedFillForText(svg, 'Alice');

    expect(fill).toBe('rgb(0, 255, 0)');
  }, 30_000);

  it("paints a sequence note's text with the theme text colour", async () => {
    // Same shape as the actor name: `#d .noteText > tspan` targets the
    // glyph-bearing tspan directly, so the outer `.noteText` element alone
    // is not enough to make this pass for the right reason.
    const svg = await renderMermaid(
      'sequenceDiagram\n  A->>B: hi\n  Note right of B: NoteBodyXyz',
      { browser },
    );

    const fill = await computedFillForText(svg, 'NoteBodyXyz');

    expect(fill).toBe('rgb(0, 255, 0)');
  }, 30_000);

  it("paints a sequence loop's condition text with the theme text colour", async () => {
    // Same shape again: `#d .loopText > tspan`. The fixed word "loop" itself
    // (class `labelText`) never wraps in a tspan in 11.17.2, but the
    // user-supplied condition always does, even when short — this is the
    // element that was actually broken.
    const svg = await renderMermaid(
      'sequenceDiagram\n  A->>B: hi\n  loop LoopCondXyz\n  A->>B: again\n  end',
      { browser },
    );

    const fill = await computedFillForText(svg, 'LoopCondXyz');

    expect(fill).toBe('rgb(0, 255, 0)');
  }, 30_000);

  it('produces output the guard passes', async () => {
    const svg = await renderMermaid('sequenceDiagram\n  A->>B: hello', { browser });

    expect(findUnsafeSvgConstructs(svg)).toEqual([]);
  }, 30_000);

  it('strips a script injected through a label', async () => {
    // Mermaid's own `securityLevel: 'strict'` should already refuse this; the
    // assertion is that OUR output is clean regardless of whether it does.
    const svg = await renderMermaid('flowchart TD\n  A["<script>alert(1)</script>"] --> B', {
      browser,
    });

    expect(findUnsafeSvgConstructs(svg)).toEqual([]);
    expect(svg).not.toContain('<script');
  }, 30_000);

  it('throws MermaidSyntaxError with the parser message on bad syntax', async () => {
    await expect(renderMermaid('flowchart TD\n  A -->', { browser })).rejects.toBeInstanceOf(
      MermaidSyntaxError,
    );

    // The MESSAGE reaches the user, so assert it carries something. An empty
    // detail string is the failure this catches: a 422 with nothing in it is
    // no better than a 500.
    await renderMermaid('this is not a diagram at all', { browser }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(MermaidSyntaxError);
      expect((error as MermaidSyntaxError).detail.length).toBeGreaterThan(0);
    });
  }, 30_000);

  it('renders each type in the themed set', async () => {
    const sources = [
      'flowchart TD\n  A --> B',
      'sequenceDiagram\n  A->>B: hi',
      'stateDiagram-v2\n  [*] --> Idle',
      'classDiagram\n  class A { +go() }',
      'erDiagram\n  A ||--o{ B : has',
      'pie title T\n  "a" : 10\n  "b" : 20',
    ];

    for (const source of sources) {
      const svg = await renderMermaid(source, { browser });
      expect(svg, source).toContain('<svg');
      expect(findUnsafeSvgConstructs(svg), source).toEqual([]);
    }
  }, 120_000);
});
