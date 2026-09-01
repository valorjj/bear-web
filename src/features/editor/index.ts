export { RichEditor } from './RichEditor';
export type { RichEditorHandle, RichEditorProps } from './RichEditor';
export { EMPTY_DOCUMENT_MARKDOWN, normalizeMarkdown, parseMarkdown } from './markdown';
export { DIAGRAM_LANGUAGE_ID } from './codeLanguages';
export { editorExtensions } from './extensions';
// CAVEAT: this is the GUESSING registry -- its own `highlightAuto` guesses a
// language rather than declining, which is correct for export
// (`src/features/export/html.ts` never calls `highlightAuto`) but wrong for
// the editor's own decorations (`extensions.ts` uses `lowlightForEditor`
// instead, deliberately not re-exported here, for exactly that reason).
export { lowlight } from './lowlight';
export { foldedKeys } from './HeadingFold';
export { headingSections } from './headingSections';
export { BottomToolbar } from './BottomToolbar';
export { TopControls } from './TopControls';
export { InfoPanel, countWords } from './InfoPanel';
