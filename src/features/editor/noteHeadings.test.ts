import { describe, expect, it } from 'vitest';

import { noteHeadings } from './noteHeadings';

/**
 * These cases were the agreement suite that pinned two heading readers to each
 * other. There is only one reader now — `noteHeadings` goes through the real
 * parser and the same `headingSections` walk the editor uses — so what they
 * pin is that reader's contract. The inline-formatting case is the one that
 * killed the regex scanner and is the reason this module exists.
 */
describe('noteHeadings', () => {
  it('returns each heading in document order, the note title excluded', () => {
    expect(noteHeadings('# Deploy Checklist\n\n## Rollback\n\na\n\n## Smoke tests\n\nb\n')).toEqual(
      ['Rollback', 'Smoke tests'],
    );
  });

  /**
   * The case a regex scanner got wrong, and the whole reason the parser is
   * used. `headingSections` reads `node.textContent`, which is the RENDERED
   * text — so a scanner reporting the source would have offered a heading the
   * navigator could never match, and the link would silently do nothing.
   */
  it('reports a heading as rendered, not as written', () => {
    expect(noteHeadings('# Title\n\n## Some **bold** and `code`\n')).toEqual([
      'Some bold and code',
    ]);
  });

  it('returns nothing for a note with no headings', () => {
    expect(noteHeadings('Just a line.\n\nAnd another.\n')).toEqual([]);
  });

  it('returns nothing for a note that is only a title', () => {
    expect(noteHeadings('# Only a title\n\nbody\n')).toEqual([]);
  });

  it('reports every level', () => {
    expect(
      noteHeadings('# Title\n\n# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n'),
    ).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
  });

  it('ignores hashes inside a fenced block', () => {
    expect(
      noteHeadings('# Title\n\n## Real\n\n```sh\n# not a heading\n```\n\n## Also real\n'),
    ).toEqual(['Real', 'Also real']);
  });

  it('keeps a heading whose text contains a slash', () => {
    // The link written for this is `[[Note/A/B split]]`, which resolves
    // because `splitLinkTarget` takes the longest TITLE prefix, not the first
    // slash. Pinned here as well as there because the two must agree.
    expect(noteHeadings('# Title\n\n## A/B split\n')).toEqual(['A/B split']);
  });

  it('reports repeated heading text once per occurrence', () => {
    expect(noteHeadings('# Title\n\n## Dup\n\na\n\n## Dup\n\nb\n')).toEqual(['Dup', 'Dup']);
  });

  it('reports a heading that follows prose rather than opening the note', () => {
    expect(noteHeadings('intro prose\n\n# A heading after prose\n')).toEqual([
      'A heading after prose',
    ]);
  });
});
