import { Node } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

import { storedImageId } from '@/data';

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

/**
 * HTML elements with no closing tag. `marked` never emits a matching `</tag>`
 * for these, so a raw-inline tokenizer must not wait for one.
 */
const VOID_HTML_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Claims inline HTML tags this editor's schema has no `parseHTML` rule for —
 * `<span>`, `<sup>`, `<sub>`, `<kbd>`, custom elements, comments — and
 * preserves them byte-for-byte instead of letting them fall into
 * `@tiptap/markdown`'s built-in inline HTML handling.
 *
 * That built-in path (`parseInlineTokens` in `@tiptap/markdown`) hard-codes a
 * schema-aware parse via `generateJSON` for any HTML tag it considers
 * "recognized" — which it defines as: a standard HTML5 tag name (regardless
 * of whether any registered node/mark actually claims it), or a hyphenated
 * custom-element name. `<span>`, `<sup>`, `<sub>`, and `<kbd>` are all
 * standard tag names, so they take that path even though nothing in this
 * schema maps them — `generateJSON` then silently drops the wrapper and
 * keeps only the inner text (`<sup>2</sup>` → `2`). Unlike the block-level
 * `html` token, this path is consulted before any registered extension
 * handler is, so no `markdownTokenName` registration can intercept it — see
 * `parseInlineTokens` at `node_modules/@tiptap/markdown/dist/index.js:776`.
 *
 * The fix is a custom inline `markdownTokenizer`, the same mechanism
 * `Highlight.ts` uses for `==text==`: it runs before `marked`'s own inline
 * tokenizers, so returning a token here preempts the built-in `html` token
 * entirely for the span it claims.
 *
 * The rule for whether to claim a tag is exact, not a heuristic: `recognizedTags`
 * is read directly off the schema built from every extension registered
 * *before* this one in `editorExtensions` (see `extensions.ts`), using the
 * identical tag-extraction `@tiptap/markdown` itself uses internally
 * (`getSchemaParseDomTags`). A tag this editor can actually represent —
 * `em`, `strong`, `mark`, `br`, `a`, … — is left alone, so `<em>hi</em>` →
 * `*hi*`, `<mark>x</mark>` → `==x==`, `<br>` → a hard break, and autolinks
 * (a distinct `link` token, never routed through this tokenizer at all)
 * continue to upgrade exactly as before. Anything else claims the full
 * open-tag-to-matching-close-tag span (or a single self-closing/void tag, or
 * an HTML comment) as one atom.
 *
 * The invariant this tokenizer must never violate: it must never claim a
 * span it cannot re-emit exactly. Claiming up to merely the *first* same-name
 * closing tag would be wrong — for nested markup like
 * `<span><span>x</span></span>` that truncates at the inner `</span>`,
 * leaving a dangling, unbalanced closer behind to be swallowed elsewhere and
 * permanently losing bytes, which is strictly worse than the pre-fix
 * behaviour (stripping the tags but keeping every character of text). So the
 * search below is depth-aware: it counts nested opens/closes of the same tag
 * name and only stops at the one that brings depth back to zero, which is
 * also what keeps two sibling tags on one line (`<span>a</span> and
 * <span>b</span>`) from being merged into a single over-claimed span — the
 * first same-name closing tag *is* the correct, balanced one for a sibling,
 * just not for a nested one.
 *
 * If no matching closing tag is found before the end of the current inline
 * span (e.g. a genuinely unclosed `<span>x`), this tokenizer declines
 * (returns `undefined`) rather than guessing how far the unclosed tag
 * reaches; that text falls through to the existing (already-imperfect, out
 * of scope here) built-in HTML handling — a non-regression, since that is
 * exactly what happened before this tokenizer existed.
 */
function createRawInlineHtml(nodeName: string, recognizedTags: ReadonlySet<string>): Node {
  const OPEN_TAG = /^<([a-zA-Z][\w-]*)((?:\s+[^<>]*)?)\s*(\/)?>/;
  const COMMENT = /^<!--[\s\S]*?-->/;

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

    markdownTokenName: nodeName,

    markdownTokenizer: {
      name: nodeName,
      level: 'inline',
      start: (src: string) => src.indexOf('<'),
      tokenize: (src: string) => {
        const commentMatch = COMMENT.exec(src);
        if (commentMatch) {
          return { type: nodeName, raw: commentMatch[0] };
        }

        const openMatch = OPEN_TAG.exec(src);
        if (!openMatch) return undefined;

        const tagName = openMatch[1].toLowerCase();
        if (recognizedTags.has(tagName)) return undefined;

        const selfClosing = Boolean(openMatch[3]) || VOID_HTML_ELEMENTS.has(tagName);
        if (selfClosing) {
          return { type: nodeName, raw: openMatch[0] };
        }

        // Nesting-aware: scan for open/close tags of this same tag name and
        // track depth, so `<span><span>x</span></span>` is claimed whole
        // rather than truncated at the first `</span>` (which would leave a
        // dangling closer behind and lose bytes — worse than the pre-fix
        // behaviour of merely stripping the wrapper and keeping the text).
        // Depth returning to zero at a sibling's close (not a descendant's)
        // is exactly what keeps two sibling `<span>`s on one line from being
        // merged into a single, over-claimed span.
        const rest = src.slice(openMatch[0].length);
        const sameTag = new RegExp(`<(/?)${tagName}(?:\\s[^>]*)?(/)?>`, 'gi');
        let depth = 1;
        let matchEnd = -1;
        let sameTagMatch: RegExpExecArray | null;
        while ((sameTagMatch = sameTag.exec(rest))) {
          const isClosing = sameTagMatch[1] === '/';
          const isSelfClosing = Boolean(sameTagMatch[2]) && !isClosing;
          if (isClosing) {
            depth -= 1;
            if (depth === 0) {
              matchEnd = sameTagMatch.index + sameTagMatch[0].length;
              break;
            }
          } else if (!isSelfClosing) {
            depth += 1;
          }
        }
        if (matchEnd === -1) return undefined;

        const raw = src.slice(0, openMatch[0].length + matchEnd);
        return { type: nodeName, raw };
      },
    },

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
/**
 * The `image` token's ONE handler, which branches.
 *
 * A stored image (`files/<id>.webp`) becomes a `storedImage` node with a real
 * `<img>`; every other destination stays a raw inline rendering its own
 * monospace source, exactly as it did before K1 — deliberately, because a note
 * that fetches from a third-party host the moment it opens turns a pasted
 * tracking pixel into a beacon.
 *
 * Branching HERE rather than registering `StoredImage` with the same
 * `markdownTokenName`: two extensions claiming one token leaves the winner to
 * the manager's iteration order, which is not a contract anyone wrote down.
 */
export const RawImage = createRawInline('rawImage', 'image').extend({
  parseMarkdown: (token: MarkdownToken) => {
    const href = typeof token.href === 'string' ? token.href : '';
    if (storedImageId(href) !== null) {
      return {
        type: 'storedImage',
        attrs: { src: href, alt: typeof token.text === 'string' ? token.text : '' },
      };
    }
    return { type: 'rawImage', attrs: { source: token.raw ?? '' } };
  },
});

/**
 * Factory, not a ready-made const like the others: the set of tags it must
 * leave alone depends on which extensions precede it in `editorExtensions`,
 * so `extensions.ts` computes that set from its own schema and passes it in.
 */
export function createRawInlineHtmlNode(recognizedTags: ReadonlySet<string>): Node {
  return createRawInlineHtml('rawInlineHtml', recognizedTags);
}
