import { describe, expect, it } from 'vitest';

import { looksLikeMarkdown } from './pastedMarkdown';

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
