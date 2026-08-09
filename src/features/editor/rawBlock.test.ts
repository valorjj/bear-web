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
  {
    name: 'inline span with no schema mapping',
    markdown: '<span>x</span>',
  },
  {
    name: 'inline superscript',
    markdown: 'H<sup>2</sup>O',
  },
  {
    name: 'inline subscript',
    markdown: '<sub>x</sub>',
  },
  {
    name: 'inline kbd',
    markdown: '<kbd>Ctrl</kbd>',
  },
  {
    name: 'inline HTML comment',
    markdown: 'a<!-- comment -->b',
  },
  {
    name: 'unknown custom element',
    markdown: '<my-custom-el>x</my-custom-el>',
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

  it('parses an unmapped inline HTML tag into a rawInlineHtml node carrying the source', () => {
    const markdown = '<span>x</span>';
    const doc = parseMarkdown(markdown);

    const [paragraph] = doc.content ?? [];
    expect(paragraph?.type).toBe('paragraph');
    const [node] = paragraph?.content ?? [];
    expect(node?.type).toBe('rawInlineHtml');
    expect(node?.attrs?.source).toBe(markdown);
  });

  it('parses an unmapped inline HTML tag nested in text into place, not dropped', () => {
    const markdown = 'H<sup>2</sup>O';
    const doc = parseMarkdown(markdown);

    const [paragraph] = doc.content ?? [];
    expect(paragraph?.content?.map((child) => child.type)).toEqual([
      'text',
      'rawInlineHtml',
      'text',
    ]);
    expect(paragraph?.content?.[1]?.attrs?.source).toBe('<sup>2</sup>');
  });
});

describe('inline HTML: the tag this editor cannot represent is rescued, not dropped', () => {
  // Without a mechanism like this, `@tiptap/markdown`'s built-in inline HTML
  // handling silently unwraps any *standard* HTML tag name (its own
  // definition of "recognized", independent of whether this schema actually
  // maps it) and keeps only the inner text — `<sup>2</sup>` becomes a bare
  // `2`. These lock in that the wrapper itself, not just its text content,
  // survives.
  const UNMAPPED_INLINE_HTML: ReadonlyArray<{ name: string; markdown: string }> = [
    { name: 'span with no schema mapping', markdown: '<span>x</span>' },
    { name: 'superscript', markdown: 'H<sup>2</sup>O' },
    { name: 'subscript', markdown: '<sub>x</sub>' },
    { name: 'kbd', markdown: '<kbd>Ctrl</kbd>' },
    { name: 'HTML comment', markdown: 'a<!-- comment -->b' },
    { name: 'unknown custom element', markdown: '<my-custom-el>x</my-custom-el>' },
  ];

  describe.each(UNMAPPED_INLINE_HTML)('$name', ({ markdown }) => {
    it('round-trips byte-for-byte', () => {
      expect(normalizeMarkdown(markdown)).toBe(markdown);
    });
  });
});

describe('inline HTML: constructs this editor upgrades must keep upgrading', () => {
  // The fix must be narrow. These four are the exact upgrades named in the
  // fix-round brief; regressing any of them to inert raw HTML is the failure
  // mode a greedy tokenizer would produce.
  it('still upgrades <em> to emphasis, not raw HTML', () => {
    const doc = parseMarkdown('<em>hi</em>');
    const [paragraph] = doc.content ?? [];
    const [node] = paragraph?.content ?? [];
    expect(node?.type).toBe('text');
    expect(node?.marks).toEqual([{ type: 'italic' }]);
    expect(normalizeMarkdown('<em>hi</em>')).toBe('*hi*');
  });

  it('still upgrades <mark> to the highlight mark, not raw HTML', () => {
    const doc = parseMarkdown('<mark>x</mark>');
    const [paragraph] = doc.content ?? [];
    const [node] = paragraph?.content ?? [];
    expect(node?.type).toBe('text');
    expect(node?.marks).toEqual([{ type: 'highlight' }]);
    expect(normalizeMarkdown('<mark>x</mark>')).toBe('==x==');
  });

  it('still upgrades <br> to a hard break, not raw HTML', () => {
    const doc = parseMarkdown('line<br>break');
    const [paragraph] = doc.content ?? [];
    expect(paragraph?.content?.map((child) => child.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(normalizeMarkdown('line<br>break')).toBe('line  \nbreak');
  });

  it('still upgrades an autolink to a link mark, not raw HTML', () => {
    const doc = parseMarkdown('<https://example.com>');
    const [paragraph] = doc.content ?? [];
    const [node] = paragraph?.content ?? [];
    expect(node?.type).toBe('text');
    expect(node?.marks?.[0]?.type).toBe('link');
    expect(node?.marks?.[0]?.attrs?.href).toBe('https://example.com');
    expect(normalizeMarkdown('<https://example.com>')).toBe(
      '[https://example.com](https://example.com)',
    );
  });
});

describe('token set derivation', () => {
  it('registers a raw node for every editorExtensions name we rely on for fallback', () => {
    const names = editorExtensions.map((extension) => extension.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'rawTable',
        'rawDefinition',
        'rawHtmlBlock',
        'rawImage',
        'rawInlineHtml',
      ]),
    );
  });
});
