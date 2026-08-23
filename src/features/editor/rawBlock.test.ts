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
  // The table case that used to live here moved to the table suites when M8b
  // gave tables a real node: a supported construct is normalized, not preserved
  // byte-for-byte, so it can no longer prove anything about the raw fallback.
  // A raw HTML block takes its place, keeping the property under test.
  it('keeps a raw HTML block intact when it is surrounded by editable content', () => {
    const source = '# Shopping\n\n<aside>note</aside>\n\nDone.';
    expect(normalizeMarkdown(source)).toBe(source);
  });

  it('does not swallow the content following an unsupported block', () => {
    const source = '<aside>note</aside>\n\nAfter the block.';
    expect(normalizeMarkdown(source)).toContain('After the block.');
  });

  it('preserves an image inline with surrounding text byte-for-byte', () => {
    const source = 'See ![alt](https://example.com/x.png) here.';
    expect(normalizeMarkdown(source)).toBe(source);
  });
});

describe('structural check: the raw node actually does the work', () => {
  it('parses a raw HTML block into a rawHtmlBlock node carrying the source, not an empty document', () => {
    const markdown = '<aside>note</aside>';
    const doc = parseMarkdown(markdown);

    expect(doc.type).toBe('doc');
    expect(doc.content).toBeDefined();
    expect(doc.content).toHaveLength(1);

    const [node] = doc.content ?? [];
    expect(node?.type).toBe('rawHtmlBlock');
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

describe('inline HTML: the tokenizer must never claim a span it cannot re-emit exactly', () => {
  // A naive "first matching close tag" scan is unsound for nested markup:
  // `<span><span>x</span></span>` would be truncated at the *inner*
  // `</span>`, leaving a dangling, unbalanced `</span>` behind to be
  // swallowed elsewhere — permanently losing bytes, which is worse than the
  // pre-fix behaviour (stripping the tags but keeping the text, i.e. `x`).
  // The matcher must be depth-aware instead: track nested opens/closes of
  // the same tag name and stop only when depth returns to zero.

  it('claims nested same-name tags whole, byte-for-byte', () => {
    const markdown = '<span><span>x</span></span>';
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });

  it('parses nested same-name tags into a single rawInlineHtml node carrying the whole span', () => {
    const markdown = '<span><span>x</span></span>';
    const doc = parseMarkdown(markdown);
    const [paragraph] = doc.content ?? [];
    expect(paragraph?.content).toHaveLength(1);
    const [node] = paragraph?.content ?? [];
    expect(node?.type).toBe('rawInlineHtml');
    expect(node?.attrs?.source).toBe(markdown);
  });

  it('claims nested different-name tags whole, byte-for-byte (guard: this already worked)', () => {
    const markdown = '<span><sup>x</sup></span>';
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });

  it('claims three levels of the same nested tag whole, byte-for-byte', () => {
    const markdown = '<span><span><span>x</span></span></span>';
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });

  it('declines an unclosed tag, no worse than the pre-fix fallback', () => {
    // Before this tokenizer existed at all, `<span>x` round-tripped to `x`
    // (the wrapper stripped, the text kept) via @tiptap/markdown's built-in
    // HTML handling. There is no balanced close to find here, so this
    // tokenizer must decline and let that same pre-existing path run —
    // not guess where the tag "should" have closed.
    expect(normalizeMarkdown('<span>x')).toBe('x');
  });

  it('declines a stray closing tag with no opener, no worse than the pre-fix fallback', () => {
    expect(normalizeMarkdown('a</span>b')).toBe('ab');
  });

  it('does not over-claim across two sibling same-name tags on one line', () => {
    // The risk a depth-aware fix introduces: a counter that doesn't reset
    // per-span could treat the *second* span's open tag as raising the
    // depth again and swallow everything up through the second span's
    // close. It must not — each top-level tag call starts its own scan, and
    // the first same-name close it meets closes its own span.
    const markdown = '<span>a</span> and <span>b</span>';
    expect(normalizeMarkdown(markdown)).toBe(markdown);

    const doc = parseMarkdown(markdown);
    const [paragraph] = doc.content ?? [];
    expect(paragraph?.content?.map((child) => child.type)).toEqual([
      'rawInlineHtml',
      'text',
      'rawInlineHtml',
    ]);
    expect(paragraph?.content?.[0]?.attrs?.source).toBe('<span>a</span>');
    expect(paragraph?.content?.[2]?.attrs?.source).toBe('<span>b</span>');
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
    // `color: null` is the DEFAULT highlight, and `==x==` is how it
    // serializes — a classless `<mark>` is still the plain form, not a
    // colour this app failed to name.
    expect(node?.marks).toEqual([{ type: 'highlight', attrs: { color: null } }]);
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
        // `rawTable` is deliberately absent since M8b: tables have a real node,
        // and a fallback for them would now be dead code claiming a token an
        // extension above already handles.
        'rawDefinition',
        'rawHtmlBlock',
        'rawImage',
        'rawInlineHtml',
      ]),
    );
  });
});
