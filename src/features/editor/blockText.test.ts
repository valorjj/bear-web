import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

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

  // A hardBreak contributes nothing to textContent but occupies one position.
  // Without a mask character here every offset after it is off by one.
  it('emits one mask character per hard break', () => {
    const block = paragraph(
      schema.text('a'),
      schema.nodes.hardBreak!.create(),
      schema.text('#work'),
    );
    const text = maskedBlockText(block);
    expect(text).toBe(`a${MASK}#work`);
    expect(text).toHaveLength(block.content.size);
  });

  // The invariant the plugin's position arithmetic depends on.
  it('always returns one character per document position', () => {
    const blocks = [
      paragraph(schema.text('plain')),
      paragraph(schema.text('a'), schema.nodes.hardBreak!.create(), schema.text('b')),
      paragraph(schema.text('x', [schema.marks.code!.create()]), schema.text('y')),
    ];
    for (const block of blocks) {
      expect(maskedBlockText(block)).toHaveLength(block.content.size);
    }
  });

  it('uses \\u0000, not a space — a space would let a tag start after code', () => {
    expect(MASK).toBe('\u0000');
  });
});
