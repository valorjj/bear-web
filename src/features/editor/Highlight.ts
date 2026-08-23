import { Mark } from '@tiptap/core';
import type { MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken } from '@tiptap/core';

/**
 * The named highlight colours, in the order the swatch row shows them.
 *
 * The DEFAULT highlight is deliberately absent from this list. `==text==`
 * carries no colour slot, so the uncoloured mark is `color: null` and renders
 * on `--bear-selected` — the same tint the app already used for every
 * highlight before colours existed. Adding a `yellow` (or `default`) entry
 * here would create two spellings of one thing: `==x==` and
 * `<mark class="hl-yellow">x</mark>` would render identically but serialize
 * differently, and the plain form has to win because it is what every
 * existing note already contains.
 */
export const HIGHLIGHT_COLORS = ['blue', 'green', 'pink', 'purple'] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

const COLOR_SET: ReadonlySet<string> = new Set(HIGHLIGHT_COLORS);

/** The class a coloured highlight carries, in the DOM and in the Markdown. */
export function highlightClass(color: HighlightColor): string {
  return `hl-${color}`;
}

function colorFromClass(value: string | null): HighlightColor | null {
  if (value === null) return null;
  for (const token of value.split(/\s+/)) {
    const name = token.startsWith('hl-') ? token.slice(3) : null;
    if (name !== null && COLOR_SET.has(name)) return name as HighlightColor;
  }
  return null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      /** Toggles the mark. `color` omitted or `null` means the default tint. */
      toggleHighlight: (color?: HighlightColor | null) => ReturnType;
      /**
       * Recolours the highlight under the cursor without toggling it off.
       *
       * Distinct from `toggleHighlight` only in the case that matters:
       * `toggleMark(type, attrs)` decides by `isActive(type, attrs)`, so a
       * DIFFERENT colour already replaces — verified by fault injection.
       * Choosing the colour the text ALREADY has is where the toggle removes
       * the highlight instead, which contradicts the `menuitemradio` the user
       * clicked. Same reasoning as the heading level menu, which sets while
       * its shortcut toggles.
       */
      setHighlightColor: (color: HighlightColor | null) => ReturnType;
    };
  }
}

/**
 * `==text==`, the convention Obsidian, Bear, and Notion understand. Chosen over
 * inventing syntax because it degrades to a visible `==` in readers that do not
 * support it, rather than to lost content.
 *
 * Underline has no equivalent and is deliberately not implemented: Bear's
 * `_underline_` collides with CommonMark italic and would round-trip
 * ambiguously.
 */
export const Highlight = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: null as HighlightColor | null,
        // Read off the CLASS, not a `style`, so the fill stays a theme token.
        // A class outside the roster reads as `null`: it is not this app's
        // syntax, and inventing a colour from it would be worse than the
        // (pre-existing) loss of an unrecognised class.
        parseHTML: (element) => colorFromClass(element.getAttribute('class')),
        renderHTML: (attributes) => {
          const color = attributes.color as HighlightColor | null;
          return color === null ? {} : { class: highlightClass(color) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0];
  },

  /**
   * Claims BOTH forms this mark serializes to. The `<mark>` half is not
   * optional politeness: without it, marked's built-in inline-HTML handling
   * takes the tag and passes its contents through as literal text, so
   * `<mark class="hl-green">**bold** green</mark>` came back with a literal
   * `\*\*bold\*\*` inside it — and that is not an exotic input, it is what
   * this app itself writes the moment a user colours a highlight over text
   * that is already bold. Lexing the inner run with `lexer.inlineTokens`, the
   * same way the `==` branch does, is what keeps the two forms equivalent.
   *
   * `start` reports whichever delimiter comes first so marked does not skip
   * past one looking for the other.
   */
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => {
      const equals = src.indexOf('==');
      const tag = src.indexOf('<mark');
      if (equals === -1) return tag;
      if (tag === -1) return equals;
      return Math.min(equals, tag);
    },
    tokenize: (src, _tokens, lexer) => {
      // Non-greedy, and it declines rather than guessing when the tag is
      // never closed — the same choice `createRawInlineHtml` makes.
      const tagMatch = /^<mark(\s[^>]*)?>([\s\S]*?)<\/mark>/.exec(src);
      if (tagMatch) {
        const classMatch = /class\s*=\s*"([^"]*)"/.exec(tagMatch[1] ?? '');
        return {
          type: 'highlight',
          raw: tagMatch[0],
          text: tagMatch[2],
          color: colorFromClass(classMatch?.[1] ?? null),
          tokens: lexer.inlineTokens(tagMatch[2]!),
        };
      }

      const match = /^==([^=]+)==/.exec(src);
      if (!match) return undefined;

      return {
        type: 'highlight',
        raw: match[0],
        text: match[1],
        color: null,
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
    helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? []), {
      color: (token as { color?: HighlightColor | null }).color ?? null,
    }),

  /**
   * Two forms, because `==` has no colour slot. The uncoloured mark keeps the
   * convention Obsidian, Bear and Notion understand; a coloured one falls back
   * to inline HTML, which GFM renders as a highlight in other readers (they
   * ignore the class and show the default fill) rather than losing it. The
   * alternative — inventing `==blue|text==` — would put the literal `blue|`
   * inside the highlight everywhere else.
   */
  renderMarkdown: (node, helpers: MarkdownRendererHelpers) => {
    const children = helpers.renderChildren(node);
    const color = (node as { attrs?: { color?: HighlightColor | null } }).attrs?.color ?? null;
    return color === null
      ? `==${children}==`
      : `<mark class="${highlightClass(color)}">${children}</mark>`;
  },

  addCommands() {
    return {
      toggleHighlight:
        (color = null) =>
        ({ commands }) =>
          commands.toggleMark(this.name, { color }),

      setHighlightColor:
        (color) =>
        ({ chain }) =>
          chain().setMark(this.name, { color }).run(),
    };
  },
});
