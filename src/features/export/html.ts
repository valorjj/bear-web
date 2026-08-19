import { getSchema } from '@tiptap/core';
import { DOMSerializer, Node as ProseMirrorNode } from '@tiptap/pm/model';

import { editorExtensions, parseMarkdown } from '@/features/editor';

/** Just enough of a note to render it. */
export interface RenderableNote {
  title: string;
  text: string;
}

/**
 * The design tokens the export stylesheet consumes.
 *
 * Read from the live cascade at export time rather than hardcoded, which is what
 * keeps this file free of colour literals — the project's rule is that every
 * colour comes from a custom property and a literal outside `tokens.css` is a
 * defect. It also means an export carries whatever theme the user is actually
 * looking at, which falls out for free.
 */
export const EXPORT_TOKEN_NAMES = [
  '--bear-bg',
  '--bear-surface',
  '--bear-text',
  '--bear-muted',
  '--bear-faint',
  '--bear-border',
  '--bear-accent',
  '--bear-hover',
  '--bear-selected',
  '--bear-tag-fill',
  '--bear-radius-sm',
  '--bear-radius-md',
  '--bear-font-sans',
  '--bear-font-mono',
  '--bear-font-size',
  '--bear-line-height',
  '--bear-line-width',
  '--bear-para-spacing',
  '--bear-para-indent',
] as const;

export type ExportTokenName = (typeof EXPORT_TOKEN_NAMES)[number];

/**
 * What each token degrades to if the cascade yields nothing — a token renamed
 * without this list being updated.
 *
 * The colour fallbacks are CSS SYSTEM COLOURS, not literals: `canvas`,
 * `canvastext` and friends resolve to the reader's own platform palette. That
 * keeps a colour literal out of this file, and it degrades to something legible
 * rather than to an invisible page, which a blank value would produce.
 */
const FALLBACKS: Record<ExportTokenName, string> = {
  '--bear-bg': 'canvas',
  '--bear-surface': 'buttonface',
  '--bear-text': 'canvastext',
  '--bear-muted': 'graytext',
  '--bear-faint': 'graytext',
  '--bear-border': 'buttonborder',
  '--bear-accent': 'linktext',
  '--bear-hover': 'buttonface',
  '--bear-selected': 'buttonface',
  '--bear-tag-fill': 'buttonface',
  '--bear-radius-sm': '4px',
  '--bear-radius-md': '6px',
  '--bear-font-sans': 'system-ui, sans-serif',
  '--bear-font-mono': 'ui-monospace, monospace',
  '--bear-font-size': '16px',
  '--bear-line-height': '1.6',
  '--bear-line-width': '40em',
  '--bear-para-spacing': '0em',
  '--bear-para-indent': '0em',
};

/** Resolves every export token against the live cascade at `root`. */
export function readExportTokens(root: Element): Record<string, string> {
  const computed = getComputedStyle(root);
  const out: Record<string, string> = {};

  for (const name of EXPORT_TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    out[name] = value === '' ? FALLBACKS[name] : value;
  }

  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The note's body as HTML, rendered through the EDITOR'S OWN SCHEMA.
 *
 * This is the whole reason export needs no Markdown pipeline of its own: the
 * document is parsed by `parseMarkdown` — the single importer of
 * `@tiptap/markdown` — and serialized by ProseMirror's own `DOMSerializer`
 * against `getSchema(editorExtensions)`. So an export can never disagree with
 * what the editor shows, and a second Markdown implementation (this project's
 * signature defect) never appears.
 *
 * The consequence to know: a construct with no node in this schema — a table —
 * falls back to `RawBlock` and exports as a `<pre>` of its own Markdown source.
 * That is the fallback working correctly, and the strongest argument for giving
 * tables a real node.
 */
export function renderNoteBody(text: string): string {
  const schema = getSchema(editorExtensions);
  const document_ = ProseMirrorNode.fromJSON(schema, parseMarkdown(text));
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document_.content, {
    document,
  });

  const host = document.createElement('div');
  host.append(fragment);
  return host.innerHTML;
}

/**
 * A complete, standalone HTML document for one note.
 *
 * Self-contained by construction: no stylesheet link, no font host, no script.
 * The `@page` rule is what makes the print pipeline produce A4 rather than
 * whatever the browser last defaulted to, and it is why PDF export needs no
 * separate document — it prints this one.
 *
 * The font stack is carried by name. A reader without Pretendard installed gets
 * the `system-ui` fallback, which is a deliberate trade: embedding a subset would
 * make every exported file hundreds of kilobytes, and CJK subsetting is where
 * that goes badly wrong.
 */
export function renderNoteHtml(
  note: RenderableNote,
  tokens: Record<string, string>,
  locale = 'en',
): string {
  const declarations = EXPORT_TOKEN_NAMES.map(
    (name) => `      ${name}: ${tokens[name] ?? FALLBACKS[name]};`,
  ).join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(note.title)}</title>
    <style>
    :root {
${declarations}
    }

    @page {
      size: A4;
      margin: 18mm 16mm;
    }

    /*
     * A reset, and it is load-bearing rather than tidiness. The app gets one
     * from Tailwind's preflight; a standalone export gets none, so the browser
     * default paragraph margin applies INSIDE a flex task item and pushes
     * the label onto its own line — the checkbox above its text, which reads as
     * the document force-wrapping every todo. Every rule below assumes it has
     * the only say over spacing.
     */
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    h1, h2, h3, h4, h5, h6, p, ul, ol, pre, blockquote, figure, dl, dd {
      margin: 0;
    }

    input[type='checkbox'] {
      margin: 0;
    }

    html {
      background: var(--bear-bg);
    }

    body {
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
      max-width: var(--bear-line-width);
      background: var(--bear-bg);
      color: var(--bear-text);
      font-family: var(--bear-font-sans);
      font-size: var(--bear-font-size);
      line-height: var(--bear-line-height);
      -webkit-text-size-adjust: 100%;
    }

    /* Mirrors the editor's own block rhythm, including the additive token. */
    body > * + * {
      margin-top: calc(0.75em + var(--bear-para-spacing));
    }

    p {
      text-indent: var(--bear-para-indent);
    }

    h1, h2, h3, h4, h5, h6 {
      font-weight: 600;
      line-height: 1.25;
      margin-top: calc(1.4em + var(--bear-para-spacing));
      /* A heading should not be the last thing on a printed page. */
      break-after: avoid;
    }

    body > :first-child {
      margin-top: 0;
    }

    h1 { font-size: 1.6em; }
    h2 { font-size: 1.35em; }
    h3 { font-size: 1.15em; }
    h4, h5, h6 { font-size: 1em; }

    ul, ol {
      padding-left: 1.5em;
    }

    li + li {
      margin-top: 0.25em;
    }

    li > p {
      margin: 0;
    }

    ul[data-type='taskList'] {
      list-style: none;
      padding-left: 0;
    }

    ul[data-type='taskList'] li {
      display: flex;
      align-items: flex-start;
      gap: 0.5em;
    }

    ul[data-type='taskList'] li > label {
      flex: 0 0 auto;
      margin-top: 0.25em;
    }

    ul[data-type='taskList'] input[type='checkbox'] {
      accent-color: var(--bear-accent);
    }

    ul[data-type='taskList'] li[data-checked='true'] > div {
      color: var(--bear-muted);
      text-decoration: line-through;
    }

    blockquote {
      margin-left: 0;
      border-left: 2px solid var(--bear-border);
      padding-left: 1em;
      color: var(--bear-muted);
    }

    code {
      font-family: var(--bear-font-mono);
      font-size: 0.9em;
      background: var(--bear-hover);
      border-radius: var(--bear-radius-sm);
      padding: 0.1em 0.3em;
    }

    pre {
      font-family: var(--bear-font-mono);
      font-size: 0.9em;
      background: var(--bear-surface);
      border: 1px solid var(--bear-border);
      border-radius: var(--bear-radius-md);
      padding: 0.75em 1em;
      overflow-x: auto;
      white-space: pre-wrap;
      /* A code block split across pages loses its frame; keep it whole. */
      break-inside: avoid;
    }

    pre code {
      background: none;
      border-radius: 0;
      padding: 0;
      font-size: inherit;
    }

    /* Real tables since M8b; before that a table exported as a block of pipes. */
    table {
      width: 100%;
      border-collapse: collapse;
      /* A table split across pages loses its header; keep it whole when it fits. */
      break-inside: avoid;
    }

    th,
    td {
      border: 1px solid var(--bear-border);
      padding: 0.35em 0.6em;
      vertical-align: top;
      text-align: left;
    }

    th {
      background: var(--bear-surface);
      font-weight: 600;
    }

    th > p,
    td > p {
      text-indent: 0;
    }

    hr {
      border: none;
      border-top: 1px solid var(--bear-border);
      margin: 1.5em 0;
    }

    a {
      color: var(--bear-accent);
      text-underline-offset: 0.15em;
    }

    mark {
      background: var(--bear-selected);
      color: inherit;
      border-radius: var(--bear-radius-sm);
      padding: 0.05em 0.15em;
    }

    /*
     * A construct with no node in the editor's schema, exported as its own
     * Markdown source. Styled to read as a quoted block rather than as code,
     * since it is the user's text and not a program.
     */
    pre[data-raw-block] {
      color: var(--bear-muted);
      background: none;
      border: none;
      border-left: 2px solid var(--bear-border);
      border-radius: 0;
      padding: 0 0 0 1em;
    }

    @media print {
      html, body {
        background: none;
      }

      body {
        padding: 0;
        max-width: none;
      }
    }
    </style>
  </head>
  <body>
${renderNoteBody(note.text)}
  </body>
</html>
`;
}
