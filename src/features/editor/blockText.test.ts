import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { findTagRanges } from '@/data';

import { editorExtensions } from './extensions';
import { MASK, maskedBlockText } from './blockText';

const schema = getSchema(editorExtensions);

/** Builds a paragraph from inline children described as [text, marks]. */
function paragraph(...children: PMNode[]): PMNode {
  return schema.nodes.paragraph!.create(null, children);
}

describe('maskedBlockText', () => {
  it('returns plain text unchanged', () => {
    const block = paragraph(schema.text('hello #work'));
    expect(maskedBlockText(block)).toBe('hello #work');
  });

  it('masks a code-marked run, preserving its length', () => {
    const block = paragraph(
      schema.text('a '),
      schema.text('#work', [schema.marks.code!.create()]),
      schema.text(' b'),
    );
    expect(maskedBlockText(block)).toBe(`a ${MASK.repeat(5)} b`);
  });

  // Every mark in this schema serializes with an opening delimiter, so the
  // first character of a marked run is preceded by `*`, `~`, `=` or `[` in the
  // Markdown — never by whitespace — and `parseTags` refuses to start a tag
  // there. Masking exactly that one character is what stops the plugin
  // inventing a pill over `**#bravo**` for a tag the index does not hold.
  it.each(['bold', 'italic', 'strike', 'highlight'])(
    'masks the first character of a %s run',
    (mark) => {
      const block = paragraph(
        schema.text('b '),
        schema.text('#bravo', [schema.marks[mark]!.create()]),
        schema.text(' e'),
      );
      expect(maskedBlockText(block)).toBe(`b ${MASK}bravo e`);
      expect(findTagRanges(maskedBlockText(block))).toEqual([]);
    },
  );

  it('masks the first character of a link run', () => {
    const block = paragraph(
      schema.text('l '),
      schema.text('#bravo', [schema.marks.link!.create({ href: 'https://e.com' })]),
    );
    expect(maskedBlockText(block)).toBe(`l ${MASK}bravo`);
  });

  // The other half of the ruling, and the reason the run is not masked whole:
  // `**see #work**` serializes with the `#` preceded by a space, so a tag
  // really is there and the pill must stay.
  it('masks only the first character, so a tag later in a marked run survives', () => {
    const block = paragraph(schema.text('see #work here', [schema.marks.bold!.create()]));
    expect(maskedBlockText(block)).toBe(`${MASK}ee #work here`);
    expect(findTagRanges(maskedBlockText(block)).map((r) => r.tag)).toEqual(['work']);
  });

  // A hardBreak contributes nothing to textContent but occupies one position.
  // Without a substitute character here every offset after it is off by one.
  it('emits a newline, not a mask, per hard break', () => {
    const block = paragraph(
      schema.text('a'),
      schema.nodes.hardBreak!.create(),
      schema.text('#work'),
    );
    const text = maskedBlockText(block);
    expect(text).toBe('a\n#work');
    expect(text).toHaveLength(block.content.size);
  });

  // The asymmetry a hard break needs and MASK cannot provide: a hard break is
  // a real line break, so a tag immediately after one must be recognized —
  // the same tag `parseTags` would find in the note's actual Markdown. A
  // code-marked run right before a tag must still block it, exactly as
  // before; that half did not change.
  it('lets a tag start right after a hard break, unlike after masked code', () => {
    const afterBreak = paragraph(
      schema.text('a'),
      schema.nodes.hardBreak!.create(),
      schema.text('#work'),
    );
    expect(findTagRanges(maskedBlockText(afterBreak)).map((r) => r.tag)).toEqual(['work']);

    const afterCode = paragraph(
      schema.text('#work', [schema.marks.code!.create()]),
      schema.text('#work'),
    );
    expect(findTagRanges(maskedBlockText(afterCode))).toEqual([]);
  });

  // The invariant the plugin's position arithmetic depends on.
  it('always returns one character per document position', () => {
    const blocks = [
      paragraph(schema.text('plain')),
      paragraph(schema.text('a'), schema.nodes.hardBreak!.create(), schema.text('b')),
      paragraph(schema.text('x', [schema.marks.code!.create()]), schema.text('y')),
      // A marked run has one character replaced, not removed. An astral first
      // character is the case that would break it: ProseMirror counts UTF-16
      // code units, so replacing a surrogate PAIR with one mask would shorten
      // the string and shift every later offset.
      paragraph(schema.text('a '), schema.text('🎉x', [schema.marks.bold!.create()])),
    ];
    for (const block of blocks) {
      expect(maskedBlockText(block)).toHaveLength(block.content.size);
    }
  });

  it('uses \\u0000, not a space — a space would let a tag start after code', () => {
    expect(MASK).toBe('\u0000');
  });
});
