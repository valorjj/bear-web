import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { normalizeMarkdown, parseMarkdown } from './markdown';

/**
 * Preservation: a construct with no extension must survive byte-for-byte.
 *
 * This is what makes M4's scope cut safe rather than merely convenient. Every
 * case here is real Markdown a user can already have in their database, written
 * in M3's textarea or restored from a JSON import.
 */
const UNSUPPORTED: ReadonlyArray<{ name: string; markdown: string }> = [
  {
    name: 'table',
    markdown: '| item | qty |\n| --- | --- |\n| bread | 2 |',
  },
  {
    name: 'image',
    markdown: '![alt text](https://example.com/cat.png)',
  },
  {
    name: 'reference definition',
    markdown: '[ref]: https://example.com',
  },
  {
    name: 'raw html block',
    markdown: '<div>raw html</div>',
  },
];

describe.each(UNSUPPORTED)('preservation: $name', ({ markdown }) => {
  it('survives a round trip byte-for-byte', () => {
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});

describe('preservation in context', () => {
  it('keeps a table intact when it is surrounded by editable content', () => {
    const source = '# Shopping\n\n| item | qty |\n| --- | --- |\n| bread | 2 |\n\nDone.';
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('does not swallow the content following an unsupported block', () => {
    const source = '| a |\n| --- |\n| b |\n\nAfter the table.';
    expect(normalizeMarkdown(source)).toContain('After the table.');
  });

  it('preserves an image inline with surrounding text byte-for-byte', () => {
    const source = 'See ![alt](https://example.com/x.png) here.';
    expect(normalizeMarkdown(source)).toBe(source);
  });
});

describe('structural check: the raw node actually does the work', () => {
  it('parses a table into a rawTable node carrying the source, not an empty document', () => {
    const markdown = '| item | qty |\n| --- | --- |\n| bread | 2 |';
    const doc = parseMarkdown(markdown);

    expect(doc.type).toBe('doc');
    expect(doc.content).toBeDefined();
    expect(doc.content).toHaveLength(1);

    const [node] = doc.content ?? [];
    expect(node?.type).toBe('rawTable');
    expect(node?.attrs?.source).toBe(markdown);
  });

  it('parses a standalone image into a rawImage node, not a dropped image', () => {
    // @tiptap/extension-paragraph's own parseMarkdown special-cases a paragraph
    // whose only token is an image: it unwraps the paragraph and parses the
    // image as a direct child (`helpers.parseChildren([tokens[0]])`) rather
    // than wrapping it — the same promotion a real Image node would get. So
    // the rawImage node lands as a direct doc child, not nested in a
    // paragraph; asserting a paragraph wrapper here would fail for the wrong
    // reason and give false confidence.
    const markdown = '![alt text](https://example.com/cat.png)';
    const doc = parseMarkdown(markdown);

    expect(doc.content).toHaveLength(1);
    const [node] = doc.content ?? [];
    expect(node?.type).toBe('rawImage');
    expect(node?.attrs?.source).toBe(markdown);
  });

  it('parses an inline image nested in text into a rawImage node in place, not dropped', () => {
    const markdown = 'See ![alt](https://example.com/x.png) here.';
    const doc = parseMarkdown(markdown);

    const [paragraph] = doc.content ?? [];
    expect(paragraph?.type).toBe('paragraph');
    expect(paragraph?.content?.map((child) => child.type)).toEqual(['text', 'rawImage', 'text']);
    expect(paragraph?.content?.[1]?.attrs?.source).toBe('![alt](https://example.com/x.png)');
  });

  it('parses a reference definition into a rawDefinition node carrying the source', () => {
    const markdown = '[ref]: https://example.com';
    const doc = parseMarkdown(markdown);

    const [node] = doc.content ?? [];
    expect(node?.type).toBe('rawDefinition');
    expect(node?.attrs?.source).toBe(markdown);
  });

  it('parses a raw HTML block into a rawHtmlBlock node carrying the source', () => {
    const markdown = '<div>raw html</div>';
    const doc = parseMarkdown(markdown);

    const [node] = doc.content ?? [];
    expect(node?.type).toBe('rawHtmlBlock');
    expect(node?.attrs?.source).toBe(markdown);
  });
});

describe('token set derivation', () => {
  it('registers a raw node for every editorExtensions name we rely on for fallback', () => {
    const names = editorExtensions.map((extension) => extension.name);
    expect(names).toEqual(
      expect.arrayContaining(['rawTable', 'rawDefinition', 'rawHtmlBlock', 'rawImage']),
    );
  });
});
