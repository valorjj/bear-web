import { describe, expect, it } from 'vitest';

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

function harness() {
  const files: Captured[] = [];
  const printed: string[] = [];

  return {
    files,
    printed,
    deps: {
      download: (filename: string, blob: Blob): void => void files.push({ filename, blob }),
      print: (frame: HTMLIFrameElement): void => void printed.push(frame.srcdoc),
    },
  };
}

/** `Blob.text()` is unavailable under the Node Blob the setup file installs. */
async function readBlob(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
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

  it('prints the same document for PDF rather than downloading anything', async () => {
    const { files, printed, deps } = harness();
    await exportNote(note, 'pdf', 'en', deps);

    // No file: the browser's print pipeline owns the save step, which is the
    // whole point of choosing it over a client-side generator.
    expect(files).toEqual([]);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('<h1>US market daily</h1>');
    expect(printed[0]).toContain('@page');
  });

  it('produces the same document for html and pdf', async () => {
    const { files, printed, deps } = harness();
    await exportNote(note, 'html', 'en', deps);
    await exportNote(note, 'pdf', 'en', deps);

    // One renderer, two destinations. If these ever diverge, a user's PDF stops
    // matching the HTML they were shown.
    expect(printed[0]).toBe(await readBlob(files[0]!.blob));
  });
});
