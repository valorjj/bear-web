import { files, storedImagePath, storedImageIds } from '@/data';
import { DiagramError, ensureDiagram } from '@/features/diagrams';
import { downloadBlob } from '@/lib/download';
import { createZip, type ZipEntry } from '@/lib/zip';

import { exportFilename, type NamedNote } from './filename';
import { collectDiagramSources, readExportTokens, renderNoteHtml } from './html';
import { requestPdf } from './requestPdf';

/**
 * `md` and `html` produce a file straight from `downloadBlob`. `pdf` produces
 * one too, but not by driving the browser's own print pipeline: laying out
 * paged media, selecting real text and embedding the fonts it used is real
 * work a client-side generator would have to reimplement (subsetting
 * Pretendard for Korean among it) — so the server renders the same document
 * with a real browser and hands back the bytes.
 */
export type ExportFormat = 'md' | 'html' | 'pdf';

export interface ExportableNote extends NamedNote {
  text: string;
}

export interface ExportNoteDeps {
  document?: Document;
  /** Injected in tests; jsdom implements neither object URLs nor downloads. */
  download?: typeof downloadBlob;
  /** Injected in tests, and passed through to `requestPdf`. */
  fetch?: typeof globalThis.fetch;
  /** Injected in tests; defaults to the real cache-first render. */
  ensureDiagram?: typeof ensureDiagram;
}

const MIME: Record<'md' | 'html', string> = {
  // `text/markdown` is the registered type (RFC 7763). The charset matters:
  // without it a CJK note opens as mojibake in editors that guess latin-1.
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
};

/**
 * Exports one note in one format.
 *
 * Markdown export is deliberately the note's text VERBATIM — no normalization,
 * no re-serialization. The text is already Markdown and already canonical (the
 * editor wrote it), so putting it back through the serializer could only change
 * it, and "export" changing a byte of the user's own file is the one thing this
 * must not do.
 */
/**
 * Every stored image a note references, as a `data:` URI.
 *
 * An image this device does not have is simply absent from the map, and
 * `renderNoteHtml` then drops the element — a note synced before its bytes
 * arrived still exports, without a broken-image icon in the middle of it.
 */
async function collectImages(text: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();

  for (const id of storedImageIds(text)) {
    const record = await files.get(id);
    if (record === undefined) continue;
    entries.set(id, await blobToDataUri(record.blob));
  }

  return entries;
}

/**
 * The stored images a note references, as zip entries under `files/`.
 *
 * An image this device does not have is skipped rather than failing the
 * export: a note synced before its bytes arrived should still produce a
 * bundle, just a smaller one.
 */
async function collectBundleFiles(text: string): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];

  for (const id of storedImageIds(text)) {
    const record = await files.get(id);
    if (record === undefined) continue;
    entries.push({
      path: storedImagePath(id),
      bytes: new Uint8Array(await record.blob.arrayBuffer()),
    });
  }

  return entries;
}

/**
 * Every diagram a note's parsed document contains, rendered and keyed by
 * source (see `collectDiagramSources` for why the source comes from the
 * parse rather than a text scan).
 *
 * A diagram that cannot be rendered -- offline, signed out, a syntax error,
 * anything `ensureDiagram` throws -- is simply ABSENT from the map, never a
 * reason to fail the whole export. `renderNoteBody` then leaves that fence
 * in place: one code block in an otherwise-finished document is a far better
 * outcome than an export that refuses to run.
 */
async function collectDiagrams(
  text: string,
  ensure: typeof ensureDiagram,
): Promise<Map<string, string>> {
  const entries = new Map<string, string>();

  for (const source of collectDiagramSources(text)) {
    try {
      entries.set(source, await ensure(source));
    } catch (error) {
      if (error instanceof DiagramError) continue;
      throw error;
    }
  }

  return entries;
}

/** `FileReader` rather than `btoa`: the latter needs a binary string and mangles bytes above 0x7f. */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportNote(
  note: ExportableNote,
  format: ExportFormat,
  locale: string,
  deps: ExportNoteDeps = {},
): Promise<void> {
  const doc = deps.document ?? document;
  const download = deps.download ?? downloadBlob;

  if (format === 'md') {
    const entries = await collectBundleFiles(note.text);

    // A plain `.md` when the note has no images. A zip holding one file would
    // make every ordinary export worse to serve one case.
    if (entries.length === 0) {
      download(exportFilename(note, 'md'), new Blob([note.text], { type: MIME.md }), doc);
      return;
    }

    // The note's text VERBATIM inside the bundle: `files/<id>.webp` must
    // survive untouched, because that relative path is the whole reason the
    // folder opens in Obsidian with the images resolving. This is what K1's
    // path decision was for.
    const name = exportFilename(note, 'md');
    download(
      exportFilename(note, 'zip'),
      createZip([{ path: name, bytes: new TextEncoder().encode(note.text) }, ...entries]),
      doc,
    );
    return;
  }

  // Resolved HERE, not inside `renderNoteHtml`: that file must not import from
  // `src/data/`, so the caller reads the blobs and hands them over.
  const images = await collectImages(note.text);
  // Only on the html/pdf path -- Markdown export is the note's text verbatim
  // and must not ask a diagram to render at all.
  const diagrams = await collectDiagrams(note.text, deps.ensureDiagram ?? ensureDiagram);

  // Read from the live root, so an export carries the theme the user is looking
  // at rather than a hardcoded palette.
  const html = renderNoteHtml(
    note,
    readExportTokens(doc.documentElement),
    locale,
    images,
    diagrams,
  );

  if (format === 'html') {
    download(exportFilename(note, 'html'), new Blob([html], { type: MIME.html }), doc);
    return;
  }

  const blob = await requestPdf(html, { fetch: deps.fetch });
  download(exportFilename(note, 'pdf'), blob, doc);
}
