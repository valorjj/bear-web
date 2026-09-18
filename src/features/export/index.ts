// `buildExportHtml` and `exportNote` are deliberately NOT re-exported here.
// `exportNote` reaches `html.ts`, which imports `@/features/editor` — the
// whole Tiptap/ProseMirror/highlight.js stack — and a barrel re-export makes
// that stack a STATIC dependency of anything importing from
// `@/features/export`, including `AppShell` (via `ExportProgressProvider`
// below). Reach these by path (`@/features/export/exportNote`) instead, or
// with `await import()` at the call site when the value is only needed once
// a user acts — `useExportRunner` already does this.
// `scripts/sourceLint.test.ts` fails if either comes back as a value export.
export type { ExportFormat, ExportableNote, ExportNoteDeps } from './exportNote';
export { ExportMenu } from './ExportMenu';
export { ExportProgressProvider, useExportProgress } from './ExportProgressContext';
export type { ExportProgress } from './ExportProgressContext';
export { exportFilename } from './filename';
// `renderNoteHtml`, `readExportTokens` and `EXPORT_TOKEN_NAMES` live in
// `./html`, which is the module that imports `@/features/editor` directly —
// see the comment above. Reach them at `@/features/export/html`.
export { useExportRunner } from './useExportRunner';
export type { ExportRunner } from './useExportRunner';
export { PdfExportError, requestPdf } from './requestPdf';
export type { PdfFailure } from './requestPdf';
