import { describe, expect, it } from 'vitest';

import { EMPTY_DOCUMENT_MARKDOWN, normalizeMarkdown } from './markdown';

/**
 * Stability: normalization must reach a fixed point immediately.
 *
 * Idempotence is the parent spec's original requirement, and on its own it is
 * NOT a sufficient test — a serializer that discarded every note would be
 * perfectly idempotent. It is meaningful only alongside the fidelity suite in
 * markdown.test.ts, which pins what each construct must actually produce.
 *
 * Every input here is valid Markdown a user could plausibly have typed in M3's
 * textarea.
 */
const NON_CANONICAL: ReadonlyArray<{ name: string; markdown: string }> = [
  { name: 'asterisk bullets', markdown: '* first\n* second' },
  { name: 'plus bullets', markdown: '+ first\n+ second' },
  { name: 'setext heading', markdown: 'Title\n=====' },
  { name: 'setext subheading', markdown: 'Subtitle\n---------' },
  { name: 'underscore bold', markdown: 'Some __bold__ text.' },
  { name: 'underscore italic', markdown: 'Some _italic_ text.' },
  { name: 'ragged list indentation', markdown: '- outer\n     - inner' },
  { name: 'trailing whitespace', markdown: 'Some text.   ' },
  { name: 'excess blank lines', markdown: 'First.\n\n\n\n\nSecond.' },
  { name: 'underscore horizontal rule', markdown: '___' },
  { name: 'star horizontal rule', markdown: '***' },
  { name: 'ordered list with parens', markdown: '1) first\n2) second' },
  { name: 'ordered list starting at three', markdown: '3. third\n4. fourth' },
  { name: 'tilde fenced code', markdown: '~~~\ncode\n~~~' },
  { name: 'indented code block', markdown: '    indented code' },
];

describe.each(NON_CANONICAL)('stability: $name', ({ markdown }) => {
  it('reaches a fixed point after one pass', () => {
    const once = normalizeMarkdown(markdown);
    expect(normalizeMarkdown(once)).toBe(once);
  });

  it('does not normalize to nothing', () => {
    // Guards the degenerate fixed point: a serializer that returned '' for
    // everything would satisfy the assertion above and destroy every note.
    expect(normalizeMarkdown(markdown)).not.toBe('');
  });
});

describe('the empty document', () => {
  it('normalizes to EMPTY_DOCUMENT_MARKDOWN', () => {
    expect(normalizeMarkdown('')).toBe(EMPTY_DOCUMENT_MARKDOWN);
  });

  it('is a fixed point', () => {
    expect(normalizeMarkdown(EMPTY_DOCUMENT_MARKDOWN)).toBe(EMPTY_DOCUMENT_MARKDOWN);
  });

  it('is distinguishable from a document with content', () => {
    expect(normalizeMarkdown('a')).not.toBe(EMPTY_DOCUMENT_MARKDOWN);
  });
});
