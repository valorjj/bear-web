import { Mark } from '@tiptap/core';
import type { MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      toggleHighlight: () => ReturnType;
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

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0];
  },

  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('=='),
    tokenize: (src, _tokens, lexer) => {
      const match = /^==([^=]+)==/.exec(src);
      if (!match) return undefined;

      return {
        type: 'highlight',
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
    helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? [])),

  renderMarkdown: (node, helpers: MarkdownRendererHelpers) => `==${helpers.renderChildren(node)}==`,

  addCommands() {
    return {
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});
