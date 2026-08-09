import { describe, expect, it } from 'vitest';

import { normalizeMarkdown, parseMarkdown } from './markdown';

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
  { name: 'fenced code block, no language', markdown: '```\nplain text\n```' },
  { name: 'fenced code block with language', markdown: '```ts\nconst x = 1;\n```' },
  { name: 'fenced code block, multi-line', markdown: '```js\nconst a = 1;\nconst b = 2;\n```' },
  { name: 'task list, unchecked', markdown: '- [ ] buy bread' },
  { name: 'task list, checked', markdown: '- [x] buy bread' },
  { name: 'task list, mixed', markdown: '- [x] done\n- [ ] not done' },
  { name: 'highlight', markdown: 'Some ==highlighted== text.' },
  { name: 'highlight at line start', markdown: '==Highlighted== opening.' },
  { name: 'highlight with bold inside', markdown: 'Some ==**bold** highlight== text.' },
];

describe.each(CANONICAL)('fidelity: $name', ({ markdown }) => {
  it('round-trips byte-for-byte', () => {
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});

describe('attribute preservation', () => {
  it('keeps the code block language in the document, not just the output', () => {
    const doc = parseMarkdown('```ts\nconst x = 1;\n```');
    expect(JSON.stringify(doc)).toContain('ts');
  });

  it('distinguishes a checked task item from an unchecked one', () => {
    const checked = normalizeMarkdown('- [x] done');
    const unchecked = normalizeMarkdown('- [ ] done');
    expect(checked).not.toBe(unchecked);
  });
});
