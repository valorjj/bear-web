import { downloadBlob } from '@/lib/download';

import { exportFilename, type NamedNote } from './filename';
import { readExportTokens, renderNoteHtml } from './html';
import { printHtmlDocument, type PrintDeps } from './print';

/**
 * `md` and `html` produce a file. `pdf` produces a print, because the browser's
 * own print pipeline is the only thing in a web page that can lay out paged
 * media, select real text and embed the fonts it used — a client-side generator
 * would mean re-implementing text layout and subsetting Pretendard for Korean.
 */
export type ExportFormat = 'md' | 'html' | 'pdf';

export interface ExportableNote extends NamedNote {
  text: string;
}

export interface ExportNoteDeps {
  document?: Document;
  /** Injected in tests; jsdom implements neither object URLs nor downloads. */
  download?: typeof downloadBlob;
  print?: PrintDeps['print'];
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
export async function exportNote(
  note: ExportableNote,
  format: ExportFormat,
  locale: string,
  deps: ExportNoteDeps = {},
): Promise<void> {
  const doc = deps.document ?? document;
  const download = deps.download ?? downloadBlob;

  if (format === 'md') {
    download(exportFilename(note, 'md'), new Blob([note.text], { type: MIME.md }), doc);
    return;
  }

  // Read from the live root, so an export carries the theme the user is looking
  // at rather than a hardcoded palette.
  const html = renderNoteHtml(note, readExportTokens(doc.documentElement), locale);

  if (format === 'html') {
    download(exportFilename(note, 'html'), new Blob([html], { type: MIME.html }), doc);
    return;
  }

  await printHtmlDocument(html, { document: doc, print: deps.print });
}
