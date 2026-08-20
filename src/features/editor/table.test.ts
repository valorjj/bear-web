import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { normalizeMarkdown, parseMarkdown, serializeMarkdown } from './markdown';

/**
 * Tables became a real node in M8b, replacing the `RawTable` fallback.
 *
 * The round-trip suites (fidelity in `markdown.test.ts`, stability in
 * `stability.test.ts`) pin what a table serializes to. They cannot see whether
 * the document underneath is a real table or a block of preserved text, because
 * both produce identical Markdown — the same blind spot that let a dead
 * `==highlight==` tokenizer and a live-but-banned underline mark ship in M4. So
 * the assertions here are STRUCTURAL, on the parsed document and on the schema.
 */
const TABLE = '| item | qty |\n| --- | --- |\n| bread | 2 |';

describe('the table schema', () => {
  it('registers table, row, header and cell nodes', () => {
    const schema = getSchema(editorExtensions);

    expect(Object.keys(schema.nodes)).toEqual(
      expect.arrayContaining(['table', 'tableRow', 'tableHeader', 'tableCell']),
    );
  });

  it('no longer registers the rawTable fallback, which would claim the same token', () => {
    const schema = getSchema(editorExtensions);

    expect(Object.keys(schema.nodes)).not.toContain('rawTable');
  });
});

describe('parsing a table', () => {
  it('produces a real table, not a preserved block of source', () => {
    const doc = parseMarkdown(TABLE);
    const [node] = doc.content ?? [];

    expect(node?.type).toBe('table');
    // The defining difference from the old fallback: no `source` attribute
    // holding the Markdown, because the structure IS the content now.
    expect(node?.attrs?.source).toBeUndefined();
  });

  it('separates the header row from the body row', () => {
    const [table] = parseMarkdown(TABLE).content ?? [];
    const rows = table?.content ?? [];

    expect(rows).toHaveLength(2);
    expect(rows[0]?.content?.map((cell) => cell.type)).toEqual(['tableHeader', 'tableHeader']);
    expect(rows[1]?.content?.map((cell) => cell.type)).toEqual(['tableCell', 'tableCell']);
  });

  it('puts each cell text in a paragraph, so cells hold real inline content', () => {
    const [table] = parseMarkdown(TABLE).content ?? [];
    const firstCell = table?.content?.[1]?.content?.[0];

    expect(firstCell?.content?.[0]?.type).toBe('paragraph');
    expect(firstCell?.content?.[0]?.content?.[0]?.text).toBe('bread');
  });

  it('keeps inline marks inside a cell rather than flattening them to text', () => {
    const [table] = parseMarkdown('| a |\n| --- |\n| **b** |').content ?? [];
    const cell = table?.content?.[1]?.content?.[0];
    const text = cell?.content?.[0]?.content?.[0];

    expect(text?.text).toBe('b');
    expect(text?.marks?.map((mark) => mark.type)).toEqual(['bold']);
  });

  it('carries column alignment as a cell attribute', () => {
    const [table] = parseMarkdown('| l | r |\n| :-- | --: |\n| 1 | 2 |').content ?? [];
    const header = table?.content?.[0]?.content ?? [];

    expect(header[0]?.attrs?.align).toBe('left');
    expect(header[1]?.attrs?.align).toBe('right');
  });
});

describe('serializing a table', () => {
  it('escapes a pipe inside a cell, so the cell survives as one cell', () => {
    // The defect this guards is data LOSS, not formatting: unescaped, the row
    // re-parses as three cells in a two-column table and the last value is
    // dropped. See `tableMarkdown.ts` for why the escape must happen after
    // rendering rather than on the document.
    const once = normalizeMarkdown('| a | b |\n| --- | --- |\n| x \\| y | z |');

    expect(once).toContain('x \\| y');
    expect(normalizeMarkdown(once)).toBe(once);

    // And the value that used to disappear is still there after two passes.
    const [table] = parseMarkdown(normalizeMarkdown(once)).content ?? [];
    const cells = table?.content?.[1]?.content ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[1]?.content?.[0]?.content?.[0]?.text).toBe('z');
  });

  it('does not add a blank line around itself when it sits between blocks', () => {
    // `renderTableToMarkdown` wraps its output in newlines and the manager
    // already joins blocks with a blank line. Stable, so idempotence alone could
    // never catch it.
    const out = normalizeMarkdown(`# Shopping\n\n${TABLE}\n\nDone.`);

    expect(out).not.toContain('\n\n\n');
    expect(out.startsWith('# Shopping\n\n|')).toBe(true);
    expect(out.endsWith('|\n\nDone.')).toBe(true);
  });

  it('round-trips a table built as a document rather than parsed from Markdown', () => {
    // Parsing then serializing exercises one direction twice. This starts from
    // the document side, which is what the editor's commands produce.
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph' }] },
                { type: 'tableHeader', content: [{ type: 'paragraph' }] },
              ],
            },
          ],
        },
      ],
    };

    const markdown = serializeMarkdown(doc);
    expect(markdown).toContain('|');
    expect(parseMarkdown(markdown).content?.[0]?.type).toBe('table');
  });
});
