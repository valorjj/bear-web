import { describe, expect, it } from 'vitest';

import { decodeEntities, htmlCarriesStructure } from './pastedMarkdown';

describe('htmlCarriesStructure', () => {
  // The question is never "which flavour looks more like Markdown" but "did
  // the source declare structure". If it did, ProseMirror's HTML path is the
  // faithful reading and this must answer true.
  it.each([
    ['a heading', '<h1>Title</h1>'],
    ['a list', '<ul><li>one</li></ul>'],
    ['a table', '<table><tr><td>a</td></tr></table>'],
    ['a code block', '<pre><code>const a = 1;</code></pre>'],
    ['an image', '<img src="x.png">'],
    ['a blockquote', '<blockquote>quoted</blockquote>'],
    // THE REASON `a` IS ON THE LIST. A paragraph copied off a web page has
    // its link in the HTML flavour and NOTHING in its plain text, so calling
    // this payload trivial would silently drop the link.
    ['a link', '<a href="x">y</a>'],
  ])('trusts the HTML flavour of %s', (_label, html) => {
    expect(htmlCarriesStructure(html)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['wrapper divs and spans', '<div><span>plain text</span></div>'],
    ['a bare paragraph', '<p>just a paragraph</p>'],
    [
      'the scaffolding a clipboard payload comes wrapped in',
      "<meta charset='utf-8'><html><head></head><body><div>text</div></body></html>",
    ],
  ])('treats %s as a plain-text document dressed in HTML', (_label, html) => {
    expect(htmlCarriesStructure(html)).toBe(false);
  });

  // The `[\s/>]` lookahead, tested rather than trusted. Without it every
  // page's own wrapper markup reads as structure — `<article>` matches `a`,
  // `<header>` matches `h1`-ish prefixes — and the Markdown path becomes
  // unreachable.
  it.each([
    ['article', '<article>text</article>'],
    ['header', '<header>text</header>'],
    ['aside', '<aside>text</aside>'],
    ['section', '<section>text</section>'],
    ['hr-prefixed nonsense', '<hrefish>text</hrefish>'],
    ['imgur-like', '<imgur>text</imgur>'],
    ['tablet', '<tablet>text</tablet>'],
  ])('does not read <%s> as a structural tag it merely prefixes', (_label, html) => {
    expect(htmlCarriesStructure(html)).toBe(false);
  });
});

describe('decodeEntities', () => {
  it.each([
    ['a non-breaking space', 'a&nbsp;b', 'a\u00A0b'],
    ['an em dash', 'a&mdash;b', 'a—b'],
    ['a right single quote', 'don&rsquo;t', 'don’t'],
    ['an ellipsis', 'wait&hellip;', 'wait…'],
    ['a copyright sign', '&copy; 2026', '© 2026'],
    ['an apostrophe', 'don&apos;t', "don't"],
    ['a decimal reference', 'a&#160;b', 'a\u00A0b'],
    ['a hex reference', 'a&#x2014;b', 'a—b'],
    ['an uppercase hex reference', 'a&#X2014;b', 'a—b'],
    ['several in one string', '&copy;&nbsp;&mdash;', '\u00A9\u00A0\u2014'],
    ['a legacy entity spelled with its semicolon', '&not;', '¬'],
  ])('decodes %s', (_label, input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  // The four the Markdown parser decodes ITSELF. Decoding them here too is a
  // double-decode: `&amp;amp;` must reach the parser intact so it becomes the
  // text `&amp;`, not `&`. And `&lt;div&gt;` must keep reaching the parser as
  // an entity pair, because the parser decodes it and then claims `<div>` as a
  // raw-HTML node — changing that would be a silent schema surprise.
  it.each([
    ['ampersand', 'AT&amp;T'],
    ['less-than', '&lt;div&gt;'],
    ['greater-than', '&gt; quoted'],
    ['double quote', '&quot;quoted&quot;'],
    ['a doubly-escaped ampersand', '&amp;amp;'],
    ['a doubly-escaped nbsp', '&amp;nbsp;'],
  ])('leaves %s untouched for the parser', (_label, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it.each([
    ['text with no ampersand at all', 'plain text'],
    ['a bare ampersand', 'Tom & Jerry'],
    ['an unterminated reference', 'a &nbsp b'],
    ['an unknown named reference', 'a &notareal; b'],
    ['an empty reference', 'a &; b'],
    ['the empty string', ''],
  ])('returns %s unchanged', (_label, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it('decodes an uppercase alias the parser does not handle', () => {
    // `&AMP;` is a legacy HTML alias the Markdown parser does NOT decode, so
    // skipping it here would leave it literal and let it gain an `&amp;` on
    // the way out. The exclusion list is therefore matched case-SENSITIVELY,
    // against exactly the four spellings the parser handles.
    expect(decodeEntities('a &AMP; b')).toBe('a & b');
  });
});
