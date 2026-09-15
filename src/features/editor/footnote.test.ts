import { describe, expect, it } from 'vitest';

import { normalizeMarkdown, parseMarkdown } from './markdown';

describe('footnote markdown', () => {
  it('parses a marker into a footnoteRef node', () => {
    const doc = parseMarkdown('Alpha[^why] beta.');
    const types = (doc.content?.[0]?.content ?? []).map((child) => child.type);

    expect(types).toContain('footnoteRef');
  });

  it('keeps the label as written', () => {
    const doc = parseMarkdown('Alpha[^why] beta.');
    const ref = (doc.content?.[0]?.content ?? []).find((c) => c.type === 'footnoteRef');

    expect(ref?.attrs?.label).toBe('why');
  });

  it('parses a definition into a footnoteDefinition node', () => {
    const doc = parseMarkdown('Alpha[^1]\n\n[^1]: Because.');
    const last = doc.content?.[doc.content.length - 1];

    expect(last?.type).toBe('footnoteDefinition');
    expect(last?.attrs?.label).toBe('1');
  });

  it('keeps inline marks inside a definition', () => {
    const doc = parseMarkdown('[^1]: Because it is **formalised**.');
    const definition = doc.content?.[0];
    const marks = (definition?.content ?? []).flatMap((c) => (c.marks ?? []).map((m) => m.type));

    expect(marks).toContain('bold');
  });

  // The whole guarantee. A construct that does not round-trip corrupts notes
  // silently, which is why `markdown.test.ts` drives the manager standalone.
  it.each([
    'Alpha[^why] and beta[^when].',
    '[^1]: Because it is formalised.',
    'Alpha[^1] beta.\n\n[^1]: Because.',
    'A label with-punctuation[^see-also].',
  ])('round-trips %s', (markdown) => {
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });

  /**
   * The narrow grammar, and each of these is a case a permissive one gets
   * wrong. A note ABOUT markdown will contain these strings.
   */
  it.each([
    ['a bare caret', 'Alpha [^ ] beta.'],
    ['an unclosed marker', 'Alpha [^why beta.'],
    ['an empty label', 'Alpha [^] beta.'],
    ['a caret inside the label', 'Alpha [^a^b] beta.'],
  ])('leaves %s as plain text', (_name, markdown) => {
    const doc = parseMarkdown(markdown);
    const types = (doc.content?.[0]?.content ?? []).map((child) => child.type);

    expect(types).not.toContain('footnoteRef');
    /*
     * ONE block, and this is the assertion that matters.
     *
     * A block tokenizer's `start` is used by marked to CUT the paragraph at
     * the reported index, so a `start` that reports every `[^` splits the
     * sentence in two — which is how this first failed, on prose that has no
     * footnote in it at all.
     *
     * Deliberately not a byte-identity check on the serialized output:
     * `Alpha [b] beta.` already round-trips to `Alpha \[b\] beta.` with no
     * footnote involved, because the serializer escapes square brackets in
     * text. That is pre-existing behaviour and not this construct's to change.
     */
    expect(doc.content).toHaveLength(1);
  });

  it('does not see a marker inside code', () => {
    const doc = parseMarkdown('Alpha `[^1]` beta.');
    const types = (doc.content?.[0]?.content ?? []).map((child) => child.type);

    expect(types).not.toContain('footnoteRef');
  });
});
