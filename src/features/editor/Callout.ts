import { Node } from '@tiptap/core';
import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';

import { type CalloutType, formatMarker, parseMarker } from './callouts';

export interface CalloutOptions {
  /**
   * The localized type names, shown as a PLACEHOLDER in an empty header.
   *
   * A placeholder, never content: `renderNoteBody` builds its schema from the
   * default `editorExtensions` with no options threaded through, so an export
   * genuinely cannot see these — and that is correct rather than a gap, because
   * a hint to the writer is not part of the note. Baking the name into the
   * Markdown would make note text depend on the UI language at the moment of
   * the last save; putting it in CSS `content:` would put user-facing Korean
   * where `ko.ts`'s completeness check cannot see it. Both were rejected.
   *
   * `null` (the default) renders no placeholder at all, which is what every
   * schema build outside the mounted editor gets.
   */
  calloutLabels: Readonly<Record<CalloutType, string>> | null;
}

/**
 * A callout's header line.
 *
 * Parsed from and rendered to `p[data-callout-title]` rather than a `div`,
 * deliberately: `computeRecognizedHtmlTags()` derives its set from every
 * `parseHTML` rule in the schema, and `div` is NOT in that set today while `p`
 * already is. Introducing `div` would change what `createRawInlineHtmlNode`
 * considers "recognized" as a side effect of adding a callout, and
 * `rawBlock.test.ts` pins `<div>raw html</div>` round-tripping verbatim.
 * Keying on a tag the schema already claims changes nothing.
 *
 * `priority` is above `Paragraph`'s so this rule is tried first; the two would
 * otherwise both match `<p data-callout-title>` and the plain paragraph would
 * win on registration order.
 *
 * Deliberately in NO group. `blockquote`'s content is `calloutTitle? block+`,
 * so leaving this out of `block` is what stops it appearing anywhere a block
 * is allowed — most importantly at the top level of `doc`.
 */
export const CalloutTitle = Node.create({
  name: 'calloutTitle',
  content: 'inline*',
  defining: true,
  priority: 1000,
  selectable: false,

  parseHTML() {
    return [{ tag: 'p[data-callout-title]' }];
  },

  renderHTML() {
    return ['p', { 'data-callout-title': '' }, 0];
  },
});

/** `text`, as a JSON text node. */
function textNode(text: string): JSONContent {
  return { type: 'text', text };
}

/**
 * The blockquote, extended to carry a callout.
 *
 * An ATTRIBUTE rather than a new node, because a callout genuinely is a
 * blockquote — that is what the Markdown says. The toolbar button,
 * `Mod+Shift+B`, nesting, `EditorContextMenu` and `editorState`'s `blockquote`
 * flag therefore all keep working untouched, and switching a callout's type is
 * `updateAttributes` rather than a content-preserving migration between two
 * node types.
 */
export const Callout = Blockquote.extend<CalloutOptions>({
  content: 'calloutTitle? block+',

  addOptions() {
    return { ...this.parent?.(), calloutLabels: null };
  },

  addAttributes() {
    return {
      callout: {
        default: null as CalloutType | null,
        parseHTML: (element) => element.getAttribute('data-callout'),
        renderHTML: (attributes) => {
          const type = attributes.callout as CalloutType | null;
          if (type === null) return {};
          const label = this.options.calloutLabels?.[type];
          return {
            'data-callout': type,
            // Read by the empty-header placeholder rule in `editor.css`. Absent
            // outside the mounted editor, which is why that rule uses
            // `attr(data-callout-label)` and renders nothing when it is unset.
            ...(label === undefined ? {} : { 'data-callout-label': label }),
          };
        },
      },
      /**
       * The marker word for a type outside the roster, kept so it serializes
       * back verbatim.
       *
       * Inventing a hue from an unknown word would be worse than the loss it
       * replaces, and dropping the text is not on the table. One attribute is
       * the price of losing nothing.
       */
      rawMarker: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-callout-raw'),
        renderHTML: (attributes) =>
          attributes.rawMarker === null ? {} : { 'data-callout-raw': attributes.rawMarker },
      },
    };
  },

  parseMarkdown: (token, helpers: MarkdownParseHelpers) => {
    const parseBlockChildren = helpers.parseBlockChildren ?? helpers.parseChildren;
    const children = parseBlockChildren(token.tokens ?? []);

    const first = children[0];
    const inline = first?.type === 'paragraph' ? (first.content ?? []) : [];
    const head = inline[0];
    const marker = head?.type === 'text' ? parseMarker(head.text ?? '') : null;

    if (marker === null) {
      return helpers.createNode('blockquote', undefined, children);
    }

    // Marks that ran past the marker inside the same paragraph — a bold title,
    // say. They belong to the title when the source used the loose form, and
    // to the body when the tight form put a newline between the two.
    const tail = inline.slice(1);
    const titleText = marker.title === '' ? [] : [textNode(marker.title)];

    const title =
      marker.rest === ''
        ? [...titleText, ...tail]
        : // Tight form: everything after the newline is body, not header.
          titleText;

    const body =
      marker.rest === ''
        ? children.slice(1)
        : [{ type: 'paragraph', content: [textNode(marker.rest), ...tail] }, ...children.slice(1)];

    return helpers.createNode(
      'blockquote',
      { callout: marker.type, rawMarker: marker.type === null ? marker.raw : null },
      [
        helpers.createNode('calloutTitle', undefined, title),
        // `block+` demands at least one child, and `> [!tip]` alone has none.
        // Supplying the paragraph here rather than leaning on `sanitize`'s
        // `fillBefore` keeps the node valid at the moment it is created.
        ...(body.length === 0 ? [helpers.createNode('paragraph', undefined, [])] : body),
      ],
    );
  },

  /**
   * Writes the LOOSE form — marker line, a bare `>`, then the body — whatever
   * the source used. Both spacings parse; only this one is emitted, so a note
   * pasted from Obsidian normalizes on its first save.
   *
   * The `>` prefixing and the `\n>\n` join are the upstream blockquote's own
   * algorithm, reproduced rather than delegated to: the first child has to
   * become a marker line instead of a rendered node, and there is no seam in
   * the parent implementation to do that through.
   */
  renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) => {
    if (node.content === undefined) return '';

    const attributes = node.attrs as { callout?: CalloutType | null; rawMarker?: string | null };
    const type = attributes?.callout ?? null;
    const raw = attributes?.rawMarker ?? null;
    const isCallout = type !== null || raw !== null;

    const rendered = node.content.map((child, index) => {
      if (isCallout && index === 0 && child.type === 'calloutTitle') {
        const title = helpers.renderChildren(child.content ?? []).trim();
        const marker = formatMarker(type, raw);
        return title === '' ? marker : `${marker} ${title}`;
      }
      return helpers.renderChild?.(child, index) ?? helpers.renderChildren([child]);
    });

    // A trailing empty block would emit a bare `>` line with nothing after it,
    // which is what `> [!tip]` with no body would otherwise serialize to.
    while (rendered.length > 1 && rendered[rendered.length - 1]!.trim() === '') rendered.pop();

    return rendered
      .map((content) =>
        content
          .split('\n')
          .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
          .join('\n'),
      )
      .join('\n>\n');
  },
});
