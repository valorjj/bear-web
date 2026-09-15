import { describe, expect, it } from 'vitest';

import { findHeadings } from './findHeadings';

describe('findHeadings', () => {
  it('returns each ATX heading in document order', () => {
    expect(findHeadings('# Title\n\n## One\n\ntext\n\n### Two\n')).toEqual(['One', 'Two']);
  });

  // `headingSections` skips the document's first block, because that block is
  // the note's NAME, not a section. The two readers must agree, so this one
  // skips it too — see `headingAgreement.test.ts`.
  it('skips the note title, which is the first block', () => {
    expect(findHeadings('# Deploy Checklist\n\n## Rollback\n')).toEqual(['Rollback']);
  });

  it('does not skip a leading heading that is preceded by prose', () => {
    expect(findHeadings('intro line\n\n# Not the title\n')).toEqual(['Not the title']);
  });

  it('ignores a # inside a fenced code block', () => {
    expect(findHeadings('# Title\n\n```sh\n# not a heading\n```\n\n## Real\n')).toEqual(['Real']);
  });

  it('strips a closing hash sequence', () => {
    expect(findHeadings('# Title\n\n## Closed ##\n')).toEqual(['Closed']);
  });

  it('requires a space after the hashes', () => {
    expect(findHeadings('# Title\n\n##NotAHeading\n')).toEqual([]);
  });

  it('ignores a heading with no text', () => {
    expect(findHeadings('# Title\n\n##\n\n## Real\n')).toEqual(['Real']);
  });
});
