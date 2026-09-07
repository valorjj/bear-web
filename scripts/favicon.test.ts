import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Guards the one asset whose every failure mode is silent.
 *
 * A favicon that is missing, unlinked, malformed or blank produces no warning,
 * no console error and no failed request — the tab simply shows the browser's
 * own default glyph, which is what this app looked like before the mark
 * existed. Nothing about the page looks wrong.
 *
 * The first version of this file only checked that certain substrings were
 * present, and it passed against a favicon that did not render at all: an XML
 * comment contained two consecutive hyphens, which XML forbids, so the whole
 * document failed to parse and Chrome dropped it. The network panel showed a
 * clean 200 with the right content type. That is why these tests parse the
 * file rather than read it, and why `e2e/favicon.spec.ts` goes further and
 * draws it — a well-formed SVG can still paint nothing.
 */
describe('favicon', () => {
  const html = readFileSync('index.html', 'utf8');
  const svg = readFileSync('public/favicon.svg', 'utf8');

  it('exists in public/', () => {
    expect(existsSync('public/favicon.svg')).toBe(true);
  });

  it('is linked from index.html at the path it actually lives at', () => {
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.svg"');
  });

  it('declares the SVG type, so browsers prefer it over a guessed .ico', () => {
    expect(html).toContain('type="image/svg+xml"');
  });

  /**
   * The failure that shipped. `DOMParser` yields a `parsererror` element
   * instead of throwing, so the check has to look for it — a bare parse call
   * would pass silently on exactly the input this exists to reject.
   */
  it('is well-formed XML', () => {
    /*
     * `DOMParser` is reached through `globalThis` with a locally declared
     * shape, not a DOM type. This file lives in the `node` tsconfig project,
     * which has no DOM lib on purpose so browser globals cannot leak into
     * Node code — the same reason `server/pdf/mermaid.ts` describes Mermaid's
     * API by hand. jsdom supplies the real object at run time. A local
     * interface, never an ambient `declare`: an ambient declaration cannot be
     * scoped to one file and would hand the whole project a DOM global.
     */
    interface ParsedNode {
      textContent: string | null;
    }
    interface ParsedDocument {
      querySelector(selector: string): ParsedNode | null;
    }
    interface DomParserLike {
      parseFromString(source: string, type: string): ParsedDocument;
    }

    const { DOMParser: Parser } = globalThis as unknown as {
      DOMParser: new () => DomParserLike;
    };
    const parsed = new Parser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')?.textContent ?? null).toBeNull();
  });

  /**
   * Named separately from the parse check, because the parse failure message
   * points at a line number rather than at the rule, and the rule is the part
   * nobody remembers: prose in an SVG comment may not contain two consecutive
   * hyphens, which rules out writing a CSS custom property by name.
   */
  it('has no double hyphen inside a comment', () => {
    const comments = svg.match(/<!--[\s\S]*?-->/g) ?? [];
    const offenders = comments.filter((c) => c.slice(4, -3).includes('--'));
    expect(offenders).toEqual([]);
  });

  /**
   * A presentation attribute holding `var()` does not reliably resolve in
   * image context, and when it fails the paths render with no stroke — a
   * blank icon that parses perfectly. The stroke belongs in a CSS rule.
   */
  it('sets its stroke from a CSS rule rather than a var() attribute', () => {
    expect(svg).not.toMatch(/stroke\s*=\s*"var\(/);
    expect(svg).toMatch(/\.mark\s*\{[^}]*stroke:/);
  });

  /**
   * At the light accent against dark browser chrome the mark is close to
   * invisible. Nothing else can catch this: the icon still renders, just too
   * dim to make out.
   */
  it('adapts to a dark tab strip', () => {
    expect(svg).toContain('prefers-color-scheme: dark');
  });
});
