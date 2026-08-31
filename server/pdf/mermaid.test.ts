import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MermaidSyntaxError, renderMermaid } from './mermaid.ts';
import { findUnsafeSvgConstructs } from './svgGuard.ts';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe('renderMermaid', () => {
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

  it('carries the theme CSS through, unevaluated', async () => {
    const svg = await renderMermaid('flowchart TD\n  A --> B', { browser });

    // The literal var() reference must survive into the SVG. If Mermaid ever
    // processes themeCSS through its colour maths, this is the assertion that
    // catches it — and the symptom otherwise is sixteen themes' worth of
    // diagrams in the wrong colours.
    expect(svg).toContain('var(--bear-text)');
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
