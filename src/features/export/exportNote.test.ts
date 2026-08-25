import { describe, expect, it, vi } from 'vitest';

import { exportNote } from './exportNote';

const note = {
  title: 'US market daily',
  text: '# US market daily\n\nBody with a #tag and `code`.\n',
  updatedAt: Date.UTC(2026, 7, 18, 5, 30),
};

interface Captured {
  filename: string;
  blob: Blob;
}

/** `Blob.text()` is unavailable under the Node Blob the setup file installs. */
async function readBlob(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function harness() {
  const files: Captured[] = [];
  // Stands in for the server: PDF is no longer a local print, so the fetch
  // it now goes through is the seam, not an iframe's `print` callback.
  const fetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(pdfBytes, { status: 200 }),
  );

  return {
    files,
    fetch,
    deps: {
      download: (filename: string, blob: Blob): void => void files.push({ filename, blob }),
      fetch: fetch as unknown as typeof globalThis.fetch,
    },
  };
}

describe('exportNote', () => {
  it('writes Markdown byte-for-byte, with no re-serialization', async () => {
    const { files, deps } = harness();
    await exportNote(note, 'md', 'en', deps);

    expect(files).toHaveLength(1);
    expect(files[0]?.filename).toBe('US market daily.md');
    // Verbatim. Round-tripping the text through the serializer on the way out
    // could only change it, and an export that rewrites the user's own file is
    // the one thing this must never do.
    expect(await readBlob(files[0]!.blob)).toBe(note.text);
  });

  it('labels the Markdown blob with a charset, so CJK does not open as mojibake', async () => {
    const { files, deps } = harness();
    await exportNote(note, 'md', 'en', deps);

    expect(files[0]?.blob.type).toContain('charset=utf-8');
  });

  it('writes a complete HTML document under an .html name', async () => {
    const { files, deps } = harness();
    await exportNote(note, 'html', 'en', deps);

    expect(files[0]?.filename).toBe('US market daily.html');
    const text = await readBlob(files[0]!.blob);
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain('<h1>US market daily</h1>');
  });

  it('carries the requested locale into the document, for hyphenation and speech', async () => {
    const { files, deps } = harness();
    await exportNote(note, 'html', 'ko', deps);

    expect(await readBlob(files[0]!.blob)).toContain('<html lang="ko">');
  });

  it('sends the rendered document to the API and downloads what it returns, under a .pdf name', async () => {
    const { files, fetch, deps } = harness();
    await exportNote(note, 'pdf', 'en', deps);

    expect(files).toHaveLength(1);
    expect(files[0]?.filename).toBe('US market daily.pdf');
    expect(await readBlob(files[0]!.blob)).toBe('%PDF-');

    // The document handed to the server is the same one `html` downloads —
    // one renderer, two destinations.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0]!;
    expect((init as RequestInit).body).toContain('<h1>US market daily</h1>');
  });

  it('sends the same document to the server for pdf as it downloads for html', async () => {
    const { files, fetch, deps } = harness();
    await exportNote(note, 'html', 'en', deps);
    await exportNote(note, 'pdf', 'en', deps);

    const [, init] = fetch.mock.calls[0]!;
    expect((init as RequestInit).body).toBe(await readBlob(files[0]!.blob));
  });
});
