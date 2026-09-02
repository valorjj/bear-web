import { describe, expect, it } from 'vitest';

import { decodeEntities, looksLikeMarkdown } from './pastedMarkdown';

describe('looksLikeMarkdown', () => {
  // Used ONLY to choose between two structured readings of the same
  // clipboard — never between structure and literal characters. Being wrong
  // here costs formatting fidelity, not a mangled document.
  it.each([
    ['a fenced code block', '```ts\nconst a = 1;\n```'],
    ['a tilde fence', '~~~\nplain\n~~~'],
    ['a table delimiter row', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['a compact table delimiter row', '|a|b|\n|---|---|\n|1|2|'],
    ['an aligned table delimiter row', '| a | b |\n| :--- | ---: |\n| 1 | 2 |'],
    ['an ATX heading', '## Weekly report'],
    ['a deep ATX heading', '###### small'],
    ['a dash list', '- one\n- two'],
    ['a star list', '* one\n* two'],
    ['a plus list', '+ one\n+ two'],
    ['an ordered list', '1. one\n2. two'],
    ['a parenthesised ordered list', '1) one\n2) two'],
    ['a blockquote', '> quoted'],
    ['a link', 'see [the docs](https://example.com) for more'],
    ['an image', '![shot](files/a.webp)'],
    ['a heading after a blank first line', '\n\n## later'],
    ['an indented heading', '   ### three spaces is still a heading'],
  ])('recognises %s', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ['ordinary prose', 'A paragraph of prose with no markers at all.'],
    ['prose with a stray underscore', 'the file_name is here'],
    ['prose with a mid-line hash', 'issue #42 is open'],
    ['prose with a mid-line dash', 'well - maybe not'],
    // DELIBERATELY not a signal. A rich source's text/html renders these
    // faithfully, and asterisks in a plain-text flavour are weaker evidence
    // than any structural marker.
    ['emphasis alone', '**bold** and _em_ and nothing else'],
    ['an over-indented heading', '    # four spaces is a code block, not a heading'],
    ['an over-indented list', '     - four spaces in'],
    ['a hash with no space', '#tag'],
    ['a table-ish line with no dashes', '| a | b |'],
    ['a dash rule with no pipe', '-----'],
    ['the empty string', ''],
  ])('does not recognise %s', (_label, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
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
