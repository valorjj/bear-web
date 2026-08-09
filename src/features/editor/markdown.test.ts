import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { normalizeMarkdown, parseMarkdown } from './markdown';

/**
 * Recursively finds the first text node in a parsed document that carries a
 * mark of the given type. Walks `content` arrays depth-first.
 *
 * Used to assert on the parsed document's structure directly, independent of
 * the serializer. A round-trip string match cannot prove a mark exists: if
 * the tokenizer that produces it is dead, the delimited source text falls
 * through as plain text and still serializes back byte-identically.
 */
function findMarkedTextNode(node: JSONContent, markType: string): JSONContent | undefined {
  if (node.type === 'text' && node.marks?.some((mark) => mark.type === markType)) {
    return node;
  }
  for (const child of node.content ?? []) {
    const found = findMarkedTextNode(child, markType);
    if (found) return found;
  }
  return undefined;
}

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

/**
 * Structural assertions on the parsed document, independent of the
 * serializer. The fidelity round-trip above cannot distinguish "the
 * highlight mark works" from "the tokenizer is dead and `==` degraded to
 * literal text" — a dead tokenizer emits no token at all, so the source
 * characters simply survive serialization unmarked. These tests inspect
 * `parseMarkdown`'s output directly so a dead tokenizer, a disabled `start`
 * hook, or a renamed tokenizer field is caught even though it round-trips.
 */
describe('highlight mark structure', () => {
  it('produces a text node carrying a highlight mark', () => {
    const doc = parseMarkdown('Some ==highlighted== text.');
    const marked = findMarkedTextNode(doc, 'highlight');
    expect(marked).toBeDefined();
  });

  it('marks only the delimited text, not the surrounding sentence', () => {
    const doc = parseMarkdown('Some ==highlighted== text.');
    const marked = findMarkedTextNode(doc, 'highlight');
    expect(marked?.text).toBe('highlighted');
  });

  it('adds no highlight mark when the source has no ==', () => {
    const doc = parseMarkdown('Some plain text.');
    const marked = findMarkedTextNode(doc, 'highlight');
    expect(marked).toBeUndefined();
  });
});
