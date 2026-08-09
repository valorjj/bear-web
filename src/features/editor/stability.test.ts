import { describe, expect, it } from 'vitest';

import {
  EMPTY_DOCUMENT_MARKDOWN,
  normalizeMarkdown,
  parseMarkdown,
  serializeMarkdown,
} from './markdown';

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

  // Fix round 1: fidelity pins exactly one string per construct and does not
  // generalise to other content of the same construct. Stability previously
  // covered only the 15 cases above, leaving every construct absent from this
  // list ungoverned for any input other than the single string fidelity
  // happens to check — a gap a reviewer demonstrated with a serializer defect
  // that was a no-op on the fidelity string but drifted, without bound, on
  // any other blockquote. Each entry below uses content distinct from
  // markdown.test.ts's fidelity strings and rawBlock.test.ts's preservation
  // strings, so this coverage is independent rather than redundant.
  { name: 'blockquote', markdown: '> A different quote.' },
  { name: 'link', markdown: 'Check [this site](https://another-example.org) out.' },
  { name: 'task list', markdown: '- [ ] walk the dog\n- [x] feed the cat' },
  { name: 'raw table', markdown: '| name | age |\n| --- | --- |\n| Alice | 30 |' },
  { name: 'inline raw html', markdown: '<span>hello</span> world' },
  { name: 'highlight', markdown: 'This ==really matters== a lot.' },
  { name: 'strikethrough', markdown: 'This is ~~outdated~~ information.' },
  { name: 'fenced code block with language', markdown: '```py\nprint("hi")\n```' },
  {
    name: 'multi-paragraph mixed constructs',
    markdown:
      '# Notes\n\nSome **bold** and a [link](https://test.dev).\n\n> A quote here.\n\n- [ ] todo item',
  },

  // Fix round 2: round 1 closed the gap for the constructs a reviewer named,
  // but the underlying principle is "every construct the schema recognizes,
  // supported or raw-fallback, needs at least one entry here" — not "every
  // construct someone happened to name." Derived by walking CANONICAL
  // (markdown.test.ts), UNSUPPORTED and the registered Raw* nodes
  // (rawBlock.test.ts / extensions.ts) end to end; see the report's coverage
  // table for the full enumeration. These five had zero stability coverage
  // before this round. Content is deliberately different from every pinned
  // fidelity/preservation string for the same construct.
  { name: 'inline code', markdown: 'Use `printf` for output.' },
  { name: 'image', markdown: '![diagram](https://example.com/diagram.svg)' },
  { name: 'reference definition', markdown: '[docs]: https://another-example.org/docs' },
  { name: 'raw html block', markdown: '<section>content here</section>' },
  // Not named in either CANONICAL or UNSUPPORTED, but a real construct
  // StarterKit registers and this codebase pins only through an HTML-upgrade
  // fidelity check ('<br>' -> 'line  \nbreak' in rawBlock.test.ts) rather than
  // through a native-markdown CANONICAL entry — so it had no stability
  // coverage under its own native syntax either. Found while deriving the
  // table below, not because a reviewer named it.
  { name: 'hard break', markdown: 'First line  \nSecond line' },

  // Final review: the existing hard-break entries are both MID-paragraph, and
  // the whole defect lives at the END of one. A trailing `<br>` serialized to
  // 'a  \n', which parses back as the plain text 'a  ' — so normalization was
  // not idempotent, and merely OPENING such a note wrote to it, churning
  // updatedAt, the note order and the tag index. A trailing hard break has no
  // Markdown spelling at all, so it is now dropped at parse time instead.
  { name: 'trailing hard break, html', markdown: 'a<br>' },
  { name: 'trailing hard break, two spaces', markdown: 'a  \n' },
];

/**
 * Totality, over the same corpus: `serializeMarkdown` must never throw on
 * `parseMarkdown`'s output. See the header of the matching suite in
 * markdown.test.ts for why this is a note-destroying failure and not a crash.
 */
describe.each(NON_CANONICAL)('totality: $name', ({ markdown }) => {
  it('serializes its own parse without throwing', () => {
    expect(() => serializeMarkdown(parseMarkdown(markdown))).not.toThrow();
  });
});

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
