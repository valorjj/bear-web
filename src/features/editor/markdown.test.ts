import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { HIGHLIGHT_COLORS } from './Highlight';
import { normalizeMarkdown, parseMarkdown, serializeMarkdown } from './markdown';

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
  // K1. The round trip is the whole guarantee for the stored-image path: the
  // `fidelity` and `totality` suites below both iterate CANONICAL.
  { name: 'stored image', markdown: '![beach](files/abc123.webp)' },
  { name: 'stored image, no alt', markdown: '![](files/abc123.webp)' },
  // K3's display width. The unresized shapes above are the byte-identical
  // guarantee — an image nobody touched must not gain a `|` on save.
  { name: 'stored image with width', markdown: '![beach|640](files/abc123.webp)' },
  { name: 'stored image, width only', markdown: '![|640](files/abc123.webp)' },
  // Still a RAW inline, and must stay one — see the privacy ruling.
  { name: 'remote image', markdown: '![remote](https://example.com/a.png)' },
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
  // The canonical form is the PADDED one, because that is what the serializer
  // emits: cells are widened to the column's widest content and the separator
  // row matches. A table typed unpadded is normalized to this, which is a
  // stability case rather than a fidelity one.
  {
    name: 'table',
    markdown: '| item  | qty |\n| ----- | --- |\n| bread | 2   |',
  },
  // The alignment row is WIDER than the columns it describes, and that is the
  // serializer's real output rather than a mistake in this fixture: it writes
  // `max(3, width)` dashes and then adds the alignment colon outside that count.
  // Pinned as-is, because fidelity's job is to state exactly what the serializer
  // produces — a prettier string here would simply be false.
  {
    name: 'table with alignment',
    markdown: '| left | right |\n| :---- | -----: |\n| a    | b     |',
  },
  { name: 'task list, unchecked', markdown: '- [ ] buy bread' },
  { name: 'task list, checked', markdown: '- [x] buy bread' },
  { name: 'task list, mixed', markdown: '- [x] done\n- [ ] not done' },
  { name: 'highlight', markdown: 'Some ==highlighted== text.' },
  { name: 'highlight at line start', markdown: '==Highlighted== opening.' },
  { name: 'highlight with bold inside', markdown: 'Some ==**bold** highlight== text.' },
  // A non-default highlight colour has no `==` form to serialize to — the
  // convention carries no colour slot — so it round-trips as inline HTML.
  // See `docs/rulings/markdown-and-schema.md`.
  {
    name: 'highlight, blue',
    markdown: 'Some <mark class="hl-blue">blue</mark> text.',
  },
  {
    name: 'highlight, colour with inline markup inside',
    markdown: 'Some <mark class="hl-green">**bold** green</mark> text.',
  },
  // M9b. The canonical form is the LOOSE one — marker line, a bare `>`, then
  // the body — because that is what the serializer emits whatever the source
  // used. The tight form Obsidian and GitHub write is a stability case.
  { name: 'callout, info', markdown: '> [!info] Heads up\n>\n> Body text.' },
  { name: 'callout, tip', markdown: '> [!tip] Try this\n>\n> Body text.' },
  { name: 'callout, success', markdown: '> [!success] Done\n>\n> Body text.' },
  { name: 'callout, warning', markdown: '> [!warning] Be careful\n>\n> Body text.' },
  { name: 'callout, danger', markdown: '> [!danger] Stop\n>\n> Body text.' },
  { name: 'callout, untitled', markdown: '> [!tip]' },
  { name: 'callout, bold title', markdown: '> [!tip] **loud**\n>\n> Body text.' },
  { name: 'callout, two body paragraphs', markdown: '> [!danger] T\n>\n> one\n>\n> two' },
  { name: 'callout, list inside', markdown: '> [!info] T\n>\n> - a\n> - b' },
  // An unrecognised marker is never a colour and never lost: it stays a plain
  // blockquote whose `rawMarker` attribute carries the word back out verbatim.
  {
    name: 'callout, unrecognised marker',
    markdown: '> [!\uc0ac\ub0b4\uacf5\uc9c0] \uc81c\ubaa9\n>\n> \ubcf8\ubb38.',
  },
];

describe.each(CANONICAL)('fidelity: $name', ({ markdown }) => {
  it('round-trips byte-for-byte', () => {
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});

describe('the callout marker', () => {
  it('is not escaped, which used to corrupt every GitHub alert on save', () => {
    // The bug M9b opens with, probed against the real pipeline on 2026-08-27:
    // before the tokenizer claimed the marker this returned
    // `> \\[!NOTE\\]`, so merely OPENING and saving a note carrying an alert
    // rewrote it. Nothing in the suite could see it.
    expect(normalizeMarkdown('> [!NOTE]\n>\n> Plain GFM alert.')).toBe(
      '> [!info]\n>\n> Plain GFM alert.',
    );
  });

  it('normalizes an alias to its canonical spelling', () => {
    expect(normalizeMarkdown('> [!CAUTION] T\n>\n> B')).toBe('> [!warning] T\n>\n> B');
  });

  it('rewrites the tight form Obsidian writes into the loose one', () => {
    // The two parse DIFFERENTLY \u2014 tight gives one paragraph carrying a hard
    // newline, loose gives two paragraphs \u2014 so this is a real conversion, not
    // a whitespace tidy.
    expect(normalizeMarkdown('> [!warning] Be careful\n> Body.')).toBe(
      '> [!warning] Be careful\n>\n> Body.',
    );
  });

  it('leaves a plain blockquote entirely alone', () => {
    expect(normalizeMarkdown('> just a quote')).toBe('> just a quote');
  });

  it('declines a marker that is not at the start of the block', () => {
    // A `[!x]` mid-sentence is prose. The escape is correct there, and this is
    // the assertion that stops the fix above from over-reaching.
    expect(normalizeMarkdown('> see [!warning] here')).toBe('> see \\[!warning\\] here');
  });
});

describe('a stray calloutTitle', () => {
  // `calloutTitle` has NO `renderMarkdown` on purpose, so a title in an invalid
  // position serializes to NOTHING — measured at `'\n\nafter'` before the
  // repair existed, with the word `stray` simply gone. A lenient renderer on
  // the node would have hidden that; the repair preserves the words AND keeps
  // the loss observable here.
  const strayFirst = {
    type: 'doc',
    content: [
      { type: 'calloutTitle', content: [{ type: 'text', text: 'stray' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ],
  };

  it('keeps its text by becoming a paragraph', () => {
    expect(serializeMarkdown(strayFirst)).toBe('stray\n\nafter');
  });

  it('is repaired inside a blockquote that is not a callout', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'calloutTitle', content: [{ type: 'text', text: 'quoted' }] }],
        },
      ],
    };

    expect(serializeMarkdown(doc)).toBe('> quoted');
  });

  it('is repaired when it sits AFTER the first child of a real callout', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          attrs: { callout: 'tip', rawMarker: null },
          content: [
            { type: 'calloutTitle', content: [{ type: 'text', text: 'T' }] },
            { type: 'calloutTitle', content: [{ type: 'text', text: 'second' }] },
          ],
        },
      ],
    };

    expect(serializeMarkdown(doc)).toBe('> [!tip] T\n>\n> second');
  });

  it('leaves a legitimate title alone', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          attrs: { callout: 'warning', rawMarker: null },
          content: [
            { type: 'calloutTitle', content: [{ type: 'text', text: 'T' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
          ],
        },
      ],
    };

    expect(serializeMarkdown(doc)).toBe('> [!warning] T\n>\n> B');
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

  // The colour attribute needs structural assertions for exactly the reason
  // the mark itself does: `<mark class="hl-blue">x</mark>` and
  // `<mark>x</mark>` both round-trip through a serializer that ignores the
  // attribute entirely, so only the parsed document can tell them apart.
  it('carries no colour for the plain == form', () => {
    const doc = parseMarkdown('Some ==highlighted== text.');
    const marked = findMarkedTextNode(doc, 'highlight');
    expect(marked?.marks?.find((m) => m.type === 'highlight')?.attrs?.color).toBeNull();
  });

  it.each(HIGHLIGHT_COLORS)('reads the %s colour off the class attribute', (color) => {
    const doc = parseMarkdown(`Some <mark class="hl-${color}">x</mark> text.`);
    const marked = findMarkedTextNode(doc, 'highlight');
    expect(marked?.marks?.find((m) => m.type === 'highlight')?.attrs?.color).toBe(color);
  });

  // A class outside the roster is not our syntax. It parses as an uncoloured
  // highlight and its class is lost — which is exactly what happens TODAY to
  // every class including our own, so this is a strict improvement rather
  // than a new lossy path. Recorded in `docs/rulings/markdown-and-schema.md`
  // alongside the other known stable-but-lossy transformations.
  it('drops a class outside the roster rather than inventing a colour', () => {
    const doc = parseMarkdown('Some <mark class="hl-chartreuse">x</mark> text.');
    const marked = findMarkedTextNode(doc, 'highlight');
    expect(marked).toBeDefined();
    expect(marked?.marks?.find((m) => m.type === 'highlight')?.attrs?.color).toBeNull();
  });

  it('serializes an uncoloured highlight as == , never as HTML', () => {
    expect(normalizeMarkdown('Some ==x== text.')).toBe('Some ==x== text.');
  });

  // The `<mark>` form has to lex its own contents. Left to marked's built-in
  // inline-HTML handling it passed them through as literal text, so a
  // colour-highlighted bold run came back as a literal `\*\*bold\*\*`. That is
  // not an exotic input — it is what this app writes as soon as a user colours
  // a highlight over text that is already bold.
  //
  // The byte-for-byte fixture above cannot see this on its own: literal
  // `**bold**` text also round-trips byte-for-byte. Only the parsed document
  // distinguishes "bold survived as a mark" from "bold survived as characters".
  it('parses inline markup INSIDE a coloured highlight as marks, not as text', () => {
    const doc = parseMarkdown('Some <mark class="hl-green">**bold** green</mark> text.');
    const bold = findMarkedTextNode(doc, 'bold');

    expect(bold?.text).toBe('bold');
    expect(bold?.marks?.map((m) => m.type).sort()).toEqual(['bold', 'highlight']);
    expect(bold?.marks?.find((m) => m.type === 'highlight')?.attrs?.color).toBe('green');
  });

  // The two spellings must land on the same document, or the app has two
  // different highlights that merely look alike.
  it('reads <mark> with no class as the same thing as ==', () => {
    expect(parseMarkdown('a <mark>x</mark> b')).toEqual(parseMarkdown('a ==x== b'));
  });

  it('declines an unclosed <mark> rather than guessing where it ends', () => {
    const doc = parseMarkdown('Some <mark class="hl-blue">unterminated text.');
    expect(findMarkedTextNode(doc, 'highlight')).toBeUndefined();
  });
});

/**
 * Totality: the serializer must never throw on the PARSER's output.
 *
 * `serializeMarkdown` emits `'1. '` for an empty ordered-list item, and
 * `parseMarkdown('1. ')` used to hand back a `listItem` with no children, which
 * `serializeMarkdown` then threw on — the round trip was not closed on the
 * serializer's own output. `NoteEditor` caught the throw, but `RichEditor` fed
 * the same document to ProseMirror, which dropped the invalid node silently,
 * and the truncation was written back. For `'1. '` the truncation was total and
 * the note was PURGED.
 *
 * Every string that must round-trip is also a string the serializer must be
 * total on, so the fidelity corpus is reused. `stability.test.ts` runs the same
 * assertion over its own corpus.
 */
const DEGENERATE_BLOCKS: readonly string[] = [
  '1. ',
  '# ',
  '- ',
  '> ',
  '* ',
  '1) ',
  '1. Milk\n2. ',
  '# \n\nbody',
  '1. \n\n',
  '- [ ] ',
  '> \n\nbody',
];

describe.each(CANONICAL)('totality: $name', ({ markdown }) => {
  it('serializes its own parse without throwing', () => {
    expect(() => serializeMarkdown(parseMarkdown(markdown))).not.toThrow();
  });
});

describe.each(DEGENERATE_BLOCKS)('totality: degenerate %j', (markdown) => {
  it('serializes its own parse without throwing', () => {
    expect(() => serializeMarkdown(parseMarkdown(markdown))).not.toThrow();
  });

  it('is a fixed point after one pass', () => {
    const once = normalizeMarkdown(markdown);
    expect(normalizeMarkdown(once)).toBe(once);
  });
});

describe('an empty block keeps its own marker', () => {
  // The reproduction from the final whole-branch review. Before the fix these
  // two lost their content entirely — '1. ' threw, and the caller's fallback
  // path ended in `notes.purge`.
  it('keeps an empty ordered list item', () => {
    expect(normalizeMarkdown('1. ')).toBe('1. ');
  });

  it('keeps an empty heading', () => {
    expect(normalizeMarkdown('# ')).toBe('# ');
  });

  it('keeps the body under an empty heading', () => {
    expect(normalizeMarkdown('# \n\nReal body text here')).toBe('# \n\nReal body text here');
  });

  it('keeps an earlier list item when a later one is empty', () => {
    expect(normalizeMarkdown('1. Milk\n2. ')).toBe('1. Milk\n2. ');
  });
});

describe('a top-level inline node', () => {
  it('is wrapped in a paragraph, so the document is valid', () => {
    // `doc` accepts BLOCK content only. An inline node as its direct child is
    // an invalid document, and every later transaction on it throws
    // `Called contentMatchAt on a node with invalid content` — which surfaces
    // as an editor that silently refuses to be typed into.
    //
    // Shipped in K1 and reachable: pasting an image into an EMPTY note leaves
    // `![](files/<id>.webp)` as the whole text, and reloading parsed it to a
    // bare `storedImage` at the top level. Found while building K3's resize,
    // because `setNodeMarkup` was the first thing to touch such a note.
    const doc = parseMarkdown('![](files/abc123.webp)');

    expect(doc.content?.[0]?.type).toBe('paragraph');
    expect(doc.content?.[0]?.content?.[0]?.type).toBe('storedImage');
  });

  it('still round-trips to the same Markdown', () => {
    // The wrapper must not add a blank line or lose the image.
    expect(normalizeMarkdown('![](files/abc123.webp)')).toBe('![](files/abc123.webp)');
  });

  it('leaves a block node at the top level alone', () => {
    const doc = parseMarkdown('# Heading');

    expect(doc.content?.[0]?.type).toBe('heading');
  });
});
