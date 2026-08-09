import { Node } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * Holds the raw Markdown source of any construct this editor has no extension
 * for, and serializes it back byte-identically.
 *
 * This closes an entire class of silent data loss in one mechanism rather than
 * construct by construct. A note containing a table can already exist — written
 * in M3's textarea, or restored from a JSON import — and without a node like
 * this, parsing it into a document with no table type and serializing back on
 * the next autosave would destroy it with no error and no recovery.
 *
 * The token set is derived empirically (see `extensions.ts` and the M4 task 5
 * report), not assumed: `markdownTokenName` accepts exactly one token type, so
 * each unsupported top-level token gets its own thin Node from this factory.
 *
 * The block is inert: it renders as dimmed monospace and is not editable as
 * structured content. M4b replaces specific fallbacks with real nodes; nothing
 * here is thrown away when that happens.
 */
function createRawBlock(nodeName: string, tokenName: string): Node {
  return Node.create({
    name: nodeName,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        source: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-source') ?? '',
          renderHTML: (attributes) => ({ 'data-source': attributes.source as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `pre[data-raw-block="${nodeName}"]` }];
    },

    renderHTML({ HTMLAttributes, node }) {
      return [
        'pre',
        {
          ...HTMLAttributes,
          'data-raw-block': nodeName,
          class: 'text-muted font-mono text-xs',
        },
        node.attrs.source as string,
      ];
    },

    markdownTokenName: tokenName,

    parseMarkdown: (token: MarkdownToken) => ({
      type: nodeName,
      attrs: { source: (token.raw ?? '').replace(/\n+$/, '') },
    }),

    renderMarkdown: (node: { attrs?: { source?: string } }) => node.attrs?.source ?? '',
  });
}

/**
 * A standalone `![alt](url)` is not a block token — `marked` tokenizes it as a
 * `paragraph` whose inline children include an `image` token, and `paragraph`
 * already has a fallback handler that would keep the paragraph while silently
 * dropping the image. Preserving it needs an inline atom claiming `image`.
 */
function createRawInline(nodeName: string, tokenName: string): Node {
  return Node.create({
    name: nodeName,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        source: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-source') ?? '',
          renderHTML: (attributes) => ({ 'data-source': attributes.source as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `span[data-raw-inline="${nodeName}"]` }];
    },

    renderHTML({ HTMLAttributes, node }) {
      return [
        'span',
        {
          ...HTMLAttributes,
          'data-raw-inline': nodeName,
          class: 'text-muted font-mono text-xs',
        },
        node.attrs.source as string,
      ];
    },

    markdownTokenName: tokenName,

    parseMarkdown: (token: MarkdownToken) => ({
      type: nodeName,
      attrs: { source: token.raw ?? '' },
    }),

    renderMarkdown: (node: { attrs?: { source?: string } }) => node.attrs?.source ?? '',
  });
}

/** Claims `marked`'s `table` token. No table extension exists until M4b. */
export const RawTable = createRawBlock('rawTable', 'table');

/** Claims `marked`'s `def` token — link/image reference definitions. */
export const RawDefinition = createRawBlock('rawDefinition', 'def');

/** Claims `marked`'s `html` token, overriding the markdown manager's own generic HTML fallback. */
export const RawHtmlBlock = createRawBlock('rawHtmlBlock', 'html');

/** Claims `marked`'s inline `image` token. No image extension exists until M4b. */
export const RawImage = createRawInline('rawImage', 'image');
