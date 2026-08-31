import { getSchema } from '@tiptap/core';
import { DOMSerializer, Node as ProseMirrorNode } from '@tiptap/pm/model';

import { storedImageId } from '@/data/images';
import { DIAGRAM_LANGUAGE_ID, editorExtensions, lowlight, parseMarkdown } from '@/features/editor';

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
  '--bear-hl-blue',
  '--bear-hl-green',
  '--bear-hl-pink',
  '--bear-hl-purple',
  '--bear-code-keyword',
  '--bear-code-string',
  '--bear-code-number',
  '--bear-code-comment',
  '--bear-code-function',
  '--bear-code-type',
  '--bear-cal-fill-info',
  '--bear-cal-edge-info',
  '--bear-cal-icon-info',
  '--bear-cal-fill-tip',
  '--bear-cal-edge-tip',
  '--bear-cal-icon-tip',
  '--bear-cal-fill-success',
  '--bear-cal-edge-success',
  '--bear-cal-icon-success',
  '--bear-cal-fill-warning',
  '--bear-cal-edge-warning',
  '--bear-cal-icon-warning',
  '--bear-cal-fill-danger',
  '--bear-cal-edge-danger',
  '--bear-cal-icon-danger',
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
  // No system colour names a highlight tint, so all four degrade to the same
  // neutral the DEFAULT highlight degrades to. A colour lost to a plain
  // highlight is exactly what every other Markdown reader already does with
  // the `<mark class>` form; an invisible or illegible one would not be.
  '--bear-hl-blue': 'buttonface',
  '--bear-hl-green': 'buttonface',
  '--bear-hl-pink': 'buttonface',
  '--bear-hl-purple': 'buttonface',
  // The same degradation as the four highlight tints above and for the same
  // reason: no system colour names a syntax role, so a renamed token reads as
  // plain legible code rather than as a guessed palette.
  '--bear-code-keyword': 'canvastext',
  '--bear-code-string': 'canvastext',
  '--bear-code-number': 'canvastext',
  '--bear-code-comment': 'canvastext',
  '--bear-code-function': 'canvastext',
  '--bear-code-type': 'canvastext',
  // A callout keeps its SHAPE when its colours are lost — the panel, the
  // bar and the bold header still say "this part matters", which is the
  // block's whole job. The fills degrade like the highlight tints above and
  // the edges like the syntax roles, so the result is a legible grey panel
  // rather than a guessed palette.
  '--bear-cal-fill-info': 'buttonface',
  '--bear-cal-fill-tip': 'buttonface',
  '--bear-cal-fill-success': 'buttonface',
  '--bear-cal-fill-warning': 'buttonface',
  '--bear-cal-fill-danger': 'buttonface',
  '--bear-cal-edge-info': 'canvastext',
  '--bear-cal-edge-tip': 'canvastext',
  '--bear-cal-edge-success': 'canvastext',
  '--bear-cal-edge-warning': 'canvastext',
  '--bear-cal-edge-danger': 'canvastext',
  // `none` rather than a fallback glyph: a mask that fails to load paints
  // the ELEMENT, so a missing icon would draw a solid square where the
  // glyph should be. An absent mask with `none` collapses to nothing, and
  // the header keeps its words.
  '--bear-cal-icon-info': 'none',
  '--bear-cal-icon-tip': 'none',
  '--bear-cal-icon-success': 'none',
  '--bear-cal-icon-warning': 'none',
  '--bear-cal-icon-danger': 'none',
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

/**
 * Just enough of lowlight's hast output to walk it. `CodeBlockLowlight`
 * applies its `.hljs-*` classes as ProseMirror decorations, which live
 * outside the document and are never part of what `DOMSerializer` produces —
 * so a static export has NONE of them unless this file re-highlights the
 * code itself. This mirrors the walk `@tiptap/extension-code-block-lowlight`
 * does internally to build its decorations, but builds real DOM nodes
 * instead of decoration ranges.
 */
interface HastTextNode {
  type: 'text';
  value: string;
}

interface HastElementNode {
  type: 'element';
  tagName: string;
  properties?: { className?: readonly string[] };
  children: readonly HastChildNode[];
}

type HastChildNode = HastTextNode | HastElementNode;

function appendHastChildren(
  children: readonly HastChildNode[],
  parent: Element,
  doc: Document,
): void {
  for (const child of children) {
    if (child.type === 'text') {
      parent.append(doc.createTextNode(child.value));
      continue;
    }

    const element = doc.createElement(child.tagName);
    const classNames = child.properties?.className;
    if (classNames && classNames.length > 0) {
      element.className = classNames.join(' ');
    }
    appendHastChildren(child.children, element, doc);
    parent.append(element);
  }
}

const LANGUAGE_CLASS_PREFIX = 'language-';

/**
 * Every distinct Mermaid diagram source a note's PARSED DOCUMENT contains, in
 * order.
 *
 * Deliberately NOT a line scan over the raw Markdown text (an earlier task
 * shipped one, `mermaidSources`, since deleted as unused once this replaced
 * its only real purpose). A scanner keyed on the fence marker sitting at line
 * start after at most three leading spaces cannot see a fence indented under
 * a `>` blockquote prefix -- CommonMark's own rule for a top-level fence. The
 * editor is unaffected -- its node view keys on the code block's language
 * wherever the block sits in the document, so a diagram inside a callout
 * renders on screen -- but a text scan feeding export would silently miss
 * exactly that case and turn the diagram back into a code block. Walking the
 * same parsed document `renderNoteBody` is about to serialize is inherently
 * consistent with what actually ends up on the page, and handles nesting for
 * free.
 *
 * Deduplicated, because the cache is content-addressed: two identical
 * diagrams in one note are one render.
 */
export function collectDiagramSources(text: string): string[] {
  const schema = getSchema(editorExtensions);
  const document_ = ProseMirrorNode.fromJSON(schema, parseMarkdown(text));
  const seen = new Set<string>();
  const sources: string[] = [];

  document_.descendants((node) => {
    if (node.type.name !== 'codeBlock') return;
    const language = node.attrs.language as string | null | undefined;
    if (typeof language !== 'string' || language.trim().toLowerCase() !== DIAGRAM_LANGUAGE_ID) {
      return;
    }

    const source = node.textContent;
    if (source.trim() === '' || seen.has(source)) return;
    seen.add(source);
    sources.push(source);
  });

  return sources;
}

/**
 * A `<script` anywhere in a diagram's markup refuses the inline outright.
 *
 * This is the last check before rendered SVG reaches an exported file
 * someone else opens -- everything upstream (the container's sanitizing DOM
 * walk, its own regex re-check, the API's boundary re-check, and the client
 * tripwire in `MermaidDiagram.ts`) has already had its turn. Written without
 * backticks on purpose -- one inside a CSS comment in this file would
 * terminate `renderNoteHtml`'s own template literal further down.
 */
const SCRIPT_TAG_PATTERN = /<\s*script\b/i;

/**
 * Replaces every `pre > code.language-mermaid` block under `host` with its
 * rendered SVG, given a source-keyed map of already-rendered diagrams.
 *
 * Mirrors `highlightCodeBlocks`'s walk in shape, and MUST run before it: a
 * diagram that gets replaced here must never also be re-highlighted as plain
 * text by that function.
 *
 * A diagram with no supplied render -- never asked for, still in flight,
 * or failed -- keeps its fence VERBATIM. An export that refuses to run is
 * worse than one carrying a code block.
 */
function replaceMermaidBlocks(host: Element, doc: Document, diagrams: Map<string, string>): void {
  for (const code of host.querySelectorAll('pre > code')) {
    const languageClass = [...code.classList].find((name) =>
      name.startsWith(LANGUAGE_CLASS_PREFIX),
    );
    if (languageClass?.slice(LANGUAGE_CLASS_PREFIX.length) !== DIAGRAM_LANGUAGE_ID) continue;

    const pre = code.parentElement;
    if (!pre) continue;

    const svg = diagrams.get(code.textContent ?? '');
    if (svg === undefined || SCRIPT_TAG_PATTERN.test(svg)) continue;

    const template = doc.createElement('template');
    template.innerHTML = svg;
    const rendered = template.content.firstElementChild;
    if (rendered === null) continue;

    pre.replaceWith(rendered);
  }
}

/**
 * Re-highlights every fenced code block under `host`, replacing its plain
 * text with the same `.hljs-*` spans the editor shows — see the note on
 * `HastChildNode` above for why this cannot be inherited from the document.
 *
 * Deliberately does NOT fall back to `lowlight.highlightAuto` for a fence
 * with no language, or one naming a language this editor does not register.
 * `codeLanguages.ts`'s `resolveLanguage` is explicit that an unknown language
 * "renders unhighlighted and keeps its fence text verbatim, and guessing
 * would silently rewrite the user's document" -- an export that guessed
 * would colour a block of plain prose as if it were code, which is not a
 * faithful rendering of what the user was looking at. Left untouched, such a
 * block keeps its plain `pre code` text exactly as `renderNoteBody` produced
 * it.
 */
function highlightCodeBlocks(host: Element, doc: Document): void {
  for (const code of host.querySelectorAll('pre > code')) {
    const languageClass = [...code.classList].find((name) =>
      name.startsWith(LANGUAGE_CLASS_PREFIX),
    );
    const language = languageClass?.slice(LANGUAGE_CLASS_PREFIX.length);
    if (!language || !lowlight.registered(language)) continue;

    const text = code.textContent ?? '';
    const tree = lowlight.highlight(language, text) as { children: readonly HastChildNode[] };

    code.replaceChildren();
    appendHastChildren(tree.children, code, doc);
  }
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
/**
 * Replaces each stored image's relative path with the bytes themselves.
 *
 * An exported file must be SELF-CONTAINED. `files/<id>.webp` resolves to
 * nothing outside this app, so leaving it in place produces a broken image in
 * every reader — and for the PDF it is worse than broken: the renderer runs in
 * a container with deliberately no route off the host (sub-project G's
 * control), so it could not fetch the bytes even if the path were absolute.
 * Inlining is what lets that isolation stay intact.
 *
 * An image with no supplied bytes is REMOVED rather than left pointing at a
 * dead path: a note synced before its image arrived should export without a
 * broken-image icon in the middle of it.
 *
 * The map is handed in. `html.ts` imports nothing from `src/data/` — the same
 * boundary `readExportTokens` keeps by taking the document rather than
 * reaching for it.
 */
function inlineImages(host: HTMLElement, images: Map<string, string>): void {
  for (const element of [...host.querySelectorAll('img[data-src]')]) {
    const id = storedImageId(element.getAttribute('data-src') ?? '');
    const dataUri = id === null ? undefined : images.get(id);

    if (dataUri === undefined) {
      element.remove();
      continue;
    }

    element.setAttribute('src', dataUri);
    element.removeAttribute('data-src');

    // The display width, carried through as an inline style so the export
    // lays out the way the editor did. `data-width` is the node's own
    // serialization, not something a reader understands.
    const width = element.getAttribute('data-width');
    if (width !== null) {
      element.setAttribute('style', `width: ${Number(width)}px; max-width: 100%;`);
      element.removeAttribute('data-width');
    }
  }
}

export function renderNoteBody(
  text: string,
  images: Map<string, string> = new Map(),
  /** Diagram source → rendered SVG markup. Absent entries keep their fence. */
  diagrams: Map<string, string> = new Map(),
): string {
  const schema = getSchema(editorExtensions);
  const document_ = ProseMirrorNode.fromJSON(schema, parseMarkdown(text));
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document_.content, {
    document,
  });

  const host = document.createElement('div');
  host.append(fragment);
  // Ordering is deliberate but currently UNOBSERVABLE: lowlight has no
  // 'mermaid' grammar registered, so highlightCodeBlocks already skips a
  // language-mermaid block regardless of which of these two runs first (see
  // the LANGUAGE_CLASS_PREFIX check inside it). The test
  // "lowlight has no mermaid grammar, which is what makes this order
  // currently unobservable" in html.test.ts pins the fact this ordering
  // depends on -- if that test ever starts failing (someone registers a
  // Mermaid grammar, or lowlight ships one), THIS call must move ahead of
  // highlightCodeBlocks for real, and needs its own ordering test at that
  // point.
  replaceMermaidBlocks(host, document, diagrams);
  highlightCodeBlocks(host, document);
  inlineImages(host, images);
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
  /** Stored-image id → `data:` URI. Anything absent is dropped from the output. */
  images: Map<string, string> = new Map(),
  /** Diagram source → rendered SVG markup. Anything absent keeps its fence. */
  diagrams: Map<string, string> = new Map(),
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

    /*
     * margin: 0 here, not 18mm 16mm. A page-box margin is Chromium's
     * unpainted band - printBackground never reaches it, so a themed
     * background stopped short of the paper edge and left a white border
     * around a dark page. The inset moves onto body's own padding below,
     * where it is inside the painted box like everything else.
     */
    @page {
      size: A4;
      margin: 0;
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

    /*
     * Backgrounds are part of the document, not decoration the printer may
     * discard. The PDF pipeline forces backgrounds via printBackground: true
     * and never applies print media at all (emulateMedia sets media: 'screen'
     * in server/pdf/render.ts), so this declaration does nothing for that path.
     * It still matters for a different reader: someone who downloads the HTML
     * export and prints it from their own browser gets Chrome's default
     * print-color-adjust: economy, which drops EVERY painted background - a
     * code block's surface, a highlight mark, a tag pill, a table's header row
     * - and leaves their text sitting on bare paper. They could tick
     * "Background graphics" in the print dialog to get it back, but a
     * checkbox buried in a browser dialog is not where this document's design
     * lives. The exact keyword is inherited, so declaring it on the root
     * covers every descendant.
     *
     * The page background itself is no longer cleared under @media print: the
     * theme owns the page, printed or not, so a dark theme prints a dark page
     * with its own light text rather than near-white text onto white paper.
     */
    html {
      background: var(--bear-bg);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }

    body {
      margin: 0 auto;
      /*
       * The inset formerly lived on @page's margin, which Chromium never
       * paints. It moved here so the theme's background covers the whole
       * sheet and the text keeps the same distance from the paper edge.
       */
      padding: 18mm 16mm;
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

    blockquote[data-callout='info'] {
      --cal-edge: var(--bear-cal-edge-info);
      --cal-fill: var(--bear-cal-fill-info);
      --cal-icon: var(--bear-cal-icon-info);
    }

    blockquote[data-callout='tip'] {
      --cal-edge: var(--bear-cal-edge-tip);
      --cal-fill: var(--bear-cal-fill-tip);
      --cal-icon: var(--bear-cal-icon-tip);
    }

    blockquote[data-callout='success'] {
      --cal-edge: var(--bear-cal-edge-success);
      --cal-fill: var(--bear-cal-fill-success);
      --cal-icon: var(--bear-cal-icon-success);
    }

    blockquote[data-callout='warning'] {
      --cal-edge: var(--bear-cal-edge-warning);
      --cal-fill: var(--bear-cal-fill-warning);
      --cal-icon: var(--bear-cal-icon-warning);
    }

    blockquote[data-callout='danger'] {
      --cal-edge: var(--bear-cal-edge-danger);
      --cal-fill: var(--bear-cal-fill-danger);
      --cal-icon: var(--bear-cal-icon-danger);
    }

    blockquote[data-callout] {
      border-left: 6px solid var(--cal-edge);
      border-radius: var(--bear-radius-md);
      background: var(--cal-fill);
      padding: 0.75em 1em;
      /* The quote rule above dims its body. A callout is the note's own
         emphasis rather than a quotation, so the text comes back. */
      color: var(--bear-text);
    }

    blockquote[data-callout] > [data-callout-title] {
      display: flex;
      align-items: center;
      gap: 0.5em;
      font-weight: 600;
      min-height: 1.4em;
    }

    /* The glyph, drawn from the same token the editor uses: readExportTokens
       copies custom properties verbatim, so there is no second copy of the
       shape here to drift from the first. Written without backticks on
       purpose — one inside a CSS comment terminates this whole template
       literal, and the parse error it raises points at the prose. */
    blockquote[data-callout] > [data-callout-title]::before {
      content: '';
      flex: none;
      width: 1.15em;
      height: 1.15em;
      background: var(--cal-edge);
      -webkit-mask-image: var(--cal-icon);
      mask-image: var(--cal-icon);
      -webkit-mask-size: contain;
      mask-size: contain;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-position: center;
      mask-position: center;
    }

    blockquote[data-callout] > :first-child {
      margin-top: 0;
    }

    blockquote[data-callout] > :last-child {
      margin-bottom: 0;
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

    /*
     * Syntax highlighting. One selector per role, listing the classes that
     * role claims -- kept in step with
     * src/features/editor/highlightClasses.ts's ROLE_CLASSES and with the
     * .hljs-* rules in src/styles/editor.css. Nothing enforces the three
     * agree; a class added to one and not the others is a defect, checked by
     * hand rather than by a test.
     */
    .hljs-keyword,
    .hljs-literal,
    .hljs-built_in,
    .hljs-selector-tag {
      color: var(--bear-code-keyword);
    }

    .hljs-string,
    .hljs-regexp,
    .hljs-char,
    .hljs-meta-string {
      color: var(--bear-code-string);
    }

    .hljs-number,
    .hljs-symbol {
      color: var(--bear-code-number);
    }

    .hljs-comment,
    .hljs-quote {
      color: var(--bear-code-comment);
    }

    .hljs-title,
    .hljs-section,
    .hljs-function,
    .function_ {
      color: var(--bear-code-function);
    }

    .hljs-type,
    .hljs-attr,
    .hljs-attribute,
    .hljs-tag,
    .hljs-name,
    .hljs-selector-class,
    .class_,
    .inherited__ {
      color: var(--bear-code-type);
    }

    /*
     * class_ (a class name) and inherited__ (the parent named in an extends
     * clause) land on the SAME span as hljs-title in java/javascript/
     * typescript/kotlin/python's class declarations. Stylesheet order, not
     * class-attribute order, decides the cascade between equal-specificity
     * selectors, so a two-class compound selector is needed to make this role
     * win deterministically rather than by which block sits later. Mirrors
     * the compound selector in src/styles/editor.css exactly.
     */
    .hljs-title.class_,
    .hljs-title.inherited__ {
      color: var(--bear-code-type);
    }

    /*
     * Two more flattening collisions, found by an empirical sweep of all
     * twelve grammars and mirrored from src/styles/editor.css -- see that
     * file's comment above the same two rules for the full reasoning. An
     * xml/html/svg/xhtml attribute value or a number substituted into a
     * template-literal string never actually gets BOTH classes on one
     * exported element (lowlight nests them as separate elements, so this
     * stylesheet never needs to break the tie on export's own DOM), but the
     * rule is kept here anyway so the three class lists this file, editor.css
     * and highlightClasses.ts carry stay identical rather than silently
     * diverging on an entry that happens not to be load-bearing today.
     */
    .hljs-tag.hljs-string {
      color: var(--bear-code-string);
    }

    .hljs-string.hljs-number {
      color: var(--bear-code-number);
    }

    /*
     * Three more, found in Kotlin by a mechanical sweep and mirrored from
     * src/styles/editor.css -- see that file's comment above the same three
     * rules. Kept here for the same reason as the two above: export's real
     * nested markup never combines these classes on one element, so none of
     * the three is load-bearing today, but the three class lists this file,
     * editor.css and highlightClasses.ts carry must stay identical.
     */
    .hljs-function.hljs-keyword {
      color: var(--bear-code-keyword);
    }

    .hljs-function.hljs-type {
      color: var(--bear-code-type);
    }

    .hljs-function.hljs-number {
      color: var(--bear-code-number);
    }

    /*
     * A fourth, mirrored from src/styles/editor.css: a parameter's string
     * default value, exactly as inside hljs-function as its numeric
     * counterpart.
     */
    .hljs-function.hljs-string {
      color: var(--bear-code-string);
    }

    /*
     * A fifth, mirrored from src/styles/editor.css: a parameter's boolean
     * (or null) default value.
     */
    .hljs-function.hljs-literal {
      color: var(--bear-code-keyword);
    }

    /*
     * A sixth, mirrored from src/styles/editor.css: Kotlin's reified
     * modifier inside a generic type parameter list, nested in a function
     * signature. A three-class compound selector, not two -- see that
     * file's comment above the same rule for why. (No backticks in this
     * comment: it lives inside a template literal.)
     */
    .hljs-function.hljs-type.hljs-keyword {
      color: var(--bear-code-keyword);
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
      margin: 0;
      /*
       * DOMSerializer emits a bare <p></p> for an empty cell, with none of the
       * trailing <br> ProseMirror inserts in the editor DOM so a caret has
       * somewhere to sit. A <p> with no line box is zero height, so an empty
       * row collapsed to padding alone (~20px) against the editor's ~40px.
       * 1lh reproduces the missing line box directly from the same
       * line-height token the editor uses, rather than a magic-number
       * min-height that would silently drift from --bear-line-height.
       */
      min-height: 1lh;
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
     * The class survives export because the document is serialized by
     * ProseMirror's own DOMSerializer, which renders the mark's own
     * renderHTML. Without these four rules every colour would silently
     * export as the default tint. (No backticks in this comment: it lives
     * inside a template literal.)
     */
    mark.hl-blue { background: var(--bear-hl-blue); }
    mark.hl-green { background: var(--bear-hl-green); }
    mark.hl-pink { background: var(--bear-hl-pink); }
    mark.hl-purple { background: var(--bear-hl-purple); }

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

    /*
     * padding is NOT reset here. It used to be, back when @page carried the
     * 18mm 16mm margin and body's own padding would have doubled it under a
     * real browser print. Now @page's margin is 0, so body's padding is the
     * only inset there is - zeroing it would run text to the paper edge.
     * max-width still drops: the line-width cap is a screen reading measure,
     * and a printed page should use its own full printable width.
     */
    @media print {
      body {
        max-width: none;
      }
    }
    </style>
  </head>
  <body>
${renderNoteBody(note.text, images, diagrams)}
  </body>
</html>
`;
}
