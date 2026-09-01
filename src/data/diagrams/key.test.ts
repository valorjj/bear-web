import { describe, expect, it } from 'vitest';

import { DIAGRAM_RENDER_VERSION, diagramKey } from './key';

describe('diagramKey', () => {
  it('is stable for the same source', async () => {
    expect(await diagramKey('flowchart TD\n A --> B')).toBe(
      await diagramKey('flowchart TD\n A --> B'),
    );
  });

  it('differs for different sources', async () => {
    expect(await diagramKey('flowchart TD\n A --> B')).not.toBe(
      await diagramKey('flowchart TD\n A --> C'),
    );
  });

  it('is 64 lowercase hex characters', async () => {
    expect(await diagramKey('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the render version changes', async () => {
    // The version is IN the key, which is what makes a Mermaid upgrade or a
    // themeCSS change invalidate every cached SVG with no migration. Asserted
    // against a hardcoded digest so bumping the constant fails HERE, with
    // this comment attached, rather than silently serving stale renders.
    expect(DIAGRAM_RENDER_VERSION).toBe(2);
    expect(await diagramKey('flowchart TD\n  A --> B')).toBe(
      // Regenerate with: node -e "crypto.subtle.digest('SHA-256', new
      // TextEncoder().encode('2\nflowchart TD\n  A --> B')).then(d =>
      // console.log(Buffer.from(d).toString('hex')))"
      '9ddee7cbb9849673ecacd0deafce1cb062429cfcc6bd354767f5558592546349',
    );
  });
});
