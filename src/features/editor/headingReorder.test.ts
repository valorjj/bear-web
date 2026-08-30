import { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { headingSections } from './headingSections';
import { dropBoundaries, planSectionMove, planSectionShift, remapFoldKeys } from './headingReorder';
import { parseMarkdown } from './markdown';

/**
 * A document, without a live editor. Every function under test takes a `doc`,
 * so the editor is scaffolding and is destroyed before the assertions run —
 * an undestroyed `Editor` throws at environment teardown (see CLAUDE.md).
 */
function docOf(markdown: string): Node {
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
  const doc = editor.state.doc;
  editor.destroy();
  return doc;
}

const THREE = 'Title\n\n## A\n\nbody a\n\n## B\n\nbody b\n\n## C\n\nbody c';

describe('dropBoundaries', () => {
  it('offers every section start plus the document end, and nothing above the title', () => {
    const doc = docOf(THREE);
    const sections = headingSections(doc);

    expect(dropBoundaries(doc)).toEqual([
      sections[0]!.pos,
      sections[1]!.pos,
      sections[2]!.pos,
      doc.content.size,
    ]);
    // The title's own position is 0 and must never be offered: a section
    // dropped there would displace the note's name.
    expect(dropBoundaries(doc)).not.toContain(0);
  });

  it('offers only the end when a note has no sections at all', () => {
    const doc = docOf('Just a title\n\nand a paragraph');
    expect(dropBoundaries(doc)).toEqual([doc.content.size]);
  });
});

describe('planSectionMove', () => {
  it('moves a section upward, inserting at the boundary unchanged', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    const move = planSectionMove(doc, [], c!.pos, a!.pos);

    expect(move).not.toBeNull();
    expect(move!.from).toBe(c!.pos);
    expect(move!.to).toBe(c!.end);
    // Moving UP: the insert point is before the deleted range, so the delete
    // does not shift it.
    expect(move!.insertAt).toBe(a!.pos);
  });

  it('shifts the insert point left by the slice size when moving downward', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);
    const size = a!.end - a!.pos;

    const move = planSectionMove(doc, [], a!.pos, c!.pos);

    expect(move!.insertAt).toBe(c!.pos - size);
  });

  it('carries the whole subtree, not just the heading', () => {
    const doc = docOf('Title\n\n## A\n\n### A1\n\nx\n\n## B\n\ny');
    const [a, a1, b] = headingSections(doc);

    const move = planSectionMove(doc, [], a!.pos, doc.content.size);

    // `end` is the next SAME-OR-HIGHER level heading, so the nested h3 is
    // inside the moved range rather than left behind.
    expect(move!.to).toBe(b!.pos);
    expect(a1!.pos).toBeGreaterThan(move!.from);
    expect(a1!.pos).toBeLessThan(move!.to);
  });

  it('rejects the two no-op boundaries and any boundary inside the moved range', () => {
    const doc = docOf('Title\n\n## A\n\n### A1\n\nx\n\n## B\n\ny');
    const [a, a1] = headingSections(doc);

    // Its own start: the section is already there.
    expect(planSectionMove(doc, [], a!.pos, a!.pos)).toBeNull();
    // Its own end: also already there.
    expect(planSectionMove(doc, [], a!.pos, a!.end)).toBeNull();
    // A boundary belonging to its own subtree: the slice cannot contain its
    // own destination.
    expect(planSectionMove(doc, [], a!.pos, a1!.pos)).toBeNull();
  });

  it('rejects a source that is not a section and a boundary that is not offered', () => {
    const doc = docOf(THREE);
    const [a] = headingSections(doc);

    expect(planSectionMove(doc, [], 0, a!.pos)).toBeNull();
    expect(planSectionMove(doc, [], a!.pos, a!.pos + 1)).toBeNull();
  });
});

describe('fold remapping', () => {
  it('keeps a fold on the section that was folded, when titles are unique', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    const move = planSectionMove(doc, ['2:0:C'], c!.pos, a!.pos);

    expect(move!.foldKeys).toEqual(['2:0:C']);
  });

  it('RENUMBERS a fold when two headings share a level and text', () => {
    // The hazard this whole function exists for. Both sections are `## Notes`,
    // so their keys differ only by `nth`. Moving the second above the first
    // makes it `nth: 0` — and without remapping the stored `2:1:Notes` would
    // point at the OTHER section, springing the folded one open and collapsing
    // one the user never touched.
    const doc = docOf('Title\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond');
    const [first, second] = headingSections(doc);
    expect(second!.nth).toBe(1);

    const move = planSectionMove(doc, ['2:1:Notes'], second!.pos, first!.pos);

    expect(move!.foldKeys).toEqual(['2:0:Notes']);
  });

  it('leaves an unmatched key alone rather than dropping it', () => {
    // B1's fail-open rule: a key matching no heading is inert, not an error,
    // and must survive the move so a later edit can re-match it.
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    const move = planSectionMove(doc, ['2:0:Gone'], c!.pos, a!.pos);

    expect(move!.foldKeys).toContain('2:0:Gone');
  });

  it('is directly testable on two hand-built lists', () => {
    const before = [
      { pos: 1, contentStart: 2, end: 5, level: 2, text: 'X', nth: 0 },
      { pos: 5, contentStart: 6, end: 9, level: 2, text: 'X', nth: 1 },
    ];
    const after = [before[1]!, before[0]!];

    expect(remapFoldKeys(before, after, ['2:1:X'])).toEqual(['2:0:X']);
    expect(remapFoldKeys(before, after, ['2:0:X'])).toEqual(['2:1:X']);
  });
});

describe('planSectionShift', () => {
  it('moves the caret’s section up one place', () => {
    const doc = docOf(THREE);
    const [a, b] = headingSections(doc);

    const move = planSectionShift(doc, [], b!.pos + 1, -1);

    expect(move!.from).toBe(b!.pos);
    expect(move!.insertAt).toBe(a!.pos);
  });

  it('moves the caret’s section down one place, past the whole next section', () => {
    const doc = docOf(THREE);
    const [a, b] = headingSections(doc);
    const size = a!.end - a!.pos;

    const move = planSectionShift(doc, [], a!.pos + 1, 1);

    // Down means "after the next sibling section", i.e. that section's end —
    // which before the delete is `b.end`.
    expect(move!.insertAt).toBe(b!.end - size);
  });

  it('returns null at each end and when the caret is in no section', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    expect(planSectionShift(doc, [], a!.pos + 1, -1)).toBeNull();
    expect(planSectionShift(doc, [], c!.pos + 1, 1)).toBeNull();
    // Inside the title, which `headingSections` excludes by construction.
    expect(planSectionShift(doc, [], 1, 1)).toBeNull();
  });
});
