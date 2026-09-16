import { describe, expect, it } from 'vitest';

import { parseSharedPage } from './parseSharedPage';

/** The smallest valid document Task 1's exporter produces. */
function page(text: string, body = ''): string {
  const json = JSON.stringify({ title: 'Note', text });
  return `<!doctype html><html lang="en"><body>${body}<script type="application/json" id="bear-source">${json}</script></body></html>`;
}

describe('parseSharedPage', () => {
  it('reads the title and text', () => {
    const result = parseSharedPage(page('Note\n\nbody\n'));

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Note');
    expect(result!.text).toBe('Note\n\nbody\n');
    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(0);
  });

  it('reads an inlined image and keeps its path', () => {
    // "AAAA" base64-decodes to four bytes.
    const img = '<img data-src="files/abc123.webp" src="data:image/webp;base64,AAAAAA==">';
    const result = parseSharedPage(page('Note\n\n![](files/abc123.webp)\n', img));

    expect(result!.images).toHaveLength(1);
    expect(result!.images[0]!.path).toBe('files/abc123.webp');
    // Duck-typed: `vitest.setup.ts` swaps the global Blob, so `instanceof`
    // is false here even for a real one.
    expect(result!.images[0]!.blob.type).toBe('image/webp');
    expect(result!.images[0]!.blob.size).toBe(4);
  });

  it('returns null for a page published before the payload existed', () => {
    // Absence is the signal. Nothing migrates and no version marker exists.
    expect(parseSharedPage('<!doctype html><html><body>hi</body></html>')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const html =
      '<!doctype html><html><body><script type="application/json" id="bear-source">{oh no</script></body></html>';
    expect(parseSharedPage(html)).toBeNull();
  });

  it('returns null for a payload of the wrong shape', () => {
    const html =
      '<!doctype html><html><body><script type="application/json" id="bear-source">{"title":1,"text":null}</script></body></html>';
    expect(parseSharedPage(html)).toBeNull();
  });

  it('returns null for a payload past the length cap', () => {
    expect(parseSharedPage(page('x'.repeat(1_000_001)))).toBeNull();
  });

  it('counts an image it cannot read rather than dropping it silently', () => {
    // A note that quietly loses a picture is worse than one that says it did.
    const img = '<img data-src="files/abc.webp" src="https://example.com/x.webp">';
    const result = parseSharedPage(page('Note\n\n![](files/abc.webp)\n', img));

    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(1);
  });

  it('ignores an img with no data-src', () => {
    // Not an image this app stored — it is a remote URL the author wrote, and
    // it stays in the text as a remote URL. Nothing to import, nothing lost.
    const img = '<img src="data:image/webp;base64,AAAAAA==">';
    const result = parseSharedPage(page('Note\n', img));

    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(0);
  });

  it('refuses a data-src that is not a stored-image path', () => {
    // The path is written into the note's text and used to build a filename.
    // Anything that is not `files/<id>.webp` is not ours.
    const img = '<img data-src="../../etc/passwd" src="data:image/webp;base64,AAAAAA==">';
    const result = parseSharedPage(page('Note\n', img));

    expect(result!.images).toEqual([]);
    expect(result!.skipped).toBe(1);
  });

  it('keeps one entry when the same image appears twice', () => {
    const img = '<img data-src="files/abc.webp" src="data:image/webp;base64,AAAAAA==">'.repeat(2);
    const result = parseSharedPage(page('Note\n', img));

    expect(result!.images).toHaveLength(1);
  });
});
