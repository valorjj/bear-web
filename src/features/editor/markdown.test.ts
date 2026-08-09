import { describe, expect, it } from 'vitest';

import { normalizeMarkdown } from './markdown';

/**
 * Fidelity: canonical Markdown, written in the serializer's own output style,
 * must survive a parse-serialize round trip byte-for-byte.
 *
 * These strings are the REVIEWED, INTENDED output for each construct. If the
 * serializer disagrees, that is a finding to report — never an expectation to
 * edit. See the plan's Global Constraints.
 */
const CANONICAL: ReadonlyArray<{ name: string; markdown: string }> = [
  { name: 'paragraph', markdown: 'Just some text.' },
  { name: 'heading 1', markdown: '# Heading one' },
  { name: 'heading 3', markdown: '### Heading three' },
  { name: 'bold', markdown: 'Some **bold** text.' },
  { name: 'italic', markdown: 'Some *italic* text.' },
  { name: 'strikethrough', markdown: 'Some ~~struck~~ text.' },
  { name: 'inline code', markdown: 'Some `code` text.' },
  { name: 'link', markdown: 'A [link](https://example.com) here.' },
  { name: 'blockquote', markdown: '> Quoted text.' },
  { name: 'horizontal rule', markdown: '---' },
  { name: 'bullet list', markdown: '- first\n- second' },
  { name: 'ordered list', markdown: '1. first\n2. second' },
  { name: 'nested bullet list', markdown: '- outer\n  - inner' },
  { name: 'two paragraphs', markdown: 'First paragraph.\n\nSecond paragraph.' },
  { name: 'heading then paragraph', markdown: '# Title\n\nBody text.' },
];

describe.each(CANONICAL)('fidelity: $name', ({ markdown }) => {
  it('round-trips byte-for-byte', () => {
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});
