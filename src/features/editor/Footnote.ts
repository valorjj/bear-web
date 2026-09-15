import { Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core';

/**
 * A footnote label: one or more characters that are not `]`, whitespace or
 * `^`.
 *
 * DELIBERATELY narrower than CommonMark, which allows almost anything between
 * the brackets. A permissive label lets `[^` swallow prose when the closing
 * bracket never comes, and a note ABOUT markdown is exactly where that
 * happens. The tag grammar carries the same scar — see
 * `docs/rulings/tag-grammar.md`.
 */
const LABEL = String.raw`([^\]\s^]+)`;
const REF = new RegExp(`^\\[\\^${LABEL}\\]`);
const DEFINITION = new RegExp(`^\\[\\^${LABEL}\\]:[ \\t]*([^\\n]*)(?:\\n|$)`);

/** The label a token carries, whatever the token's own shape. */
function labelOf(token: MarkdownToken): string {
  return (token as { label?: string }).label ?? '';
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /**
       * Inserts a marker at the caret, creates its footnote, and puts the
       * caret in the footnote ready to type.
       *
       * ONE transaction, so one undo restores both halves. Two would make the
       * writer undo twice for a single gesture — the rule
       * `moveHeadingSection` already follows for the same reason.
       */
      insertFootnote: () => ReturnType;
    };
  }
}

/**
 * The next free NUMERIC label.
 *
 * Numeric even though a label may be a word: a label the app invents should
 * read like what it is, and a word label is a choice the writer makes
 * deliberately. `max + 1` rather than "first gap", so a footnote inserted
 * after `[^1]` and `[^3]` becomes 4 and never silently re-uses a label the
 * writer deleted a marker for but kept the note of.
 */
function nextLabel(doc: import('@tiptap/pm/model').Node): string {
  let highest = 0;
  doc.descendants((node) => {
    if (node.type.name !== 'footnoteRef' && node.type.name !== 'footnoteDefinition') return true;
    const value = Number(node.attrs.label);
    if (Number.isInteger(value) && value > highest) highest = value;
    return false;
  });
  return String(highest + 1);
}

/**
 * `[^label]` in the prose.
 *
 * An ATOM: it has no text content of its own. The number a reader sees is
 * derived from the order of first reference (`footnoteNumbers`) and painted as
 * a decoration in the editor, or written in by `renderNoteBody` for an export.
 * Storing it in an attribute would put derived data in the document, where it
 * goes stale the moment a marker is inserted above it — and would then be
 * serialized into the user's file.
 */
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-footnote-ref') ?? '',
        renderHTML: (attributes) => ({ 'data-footnote-ref': attributes.label as string }),
      },
    };
  },

  /**
   * NO `parseHTML`, deliberately, and this is the third shape tried.
   *
   * `computeRecognizedHtmlTags` (`extensions.ts`) derives the tags this editor
   * claims from every node's `parseHTML` TAG NAME and ignores the attribute
   * filter. So `sup[data-footnote-ref]` claimed bare `sup`, and `RawBlock`
   * stopped rescuing raw `<sup>` as unmapped HTML — `H<sup>2</sup>O` in a note
   * silently became `H2O`. Moving to `span[data-footnote-ref]` did the same to
   * `<span>`, worse: 8 failures instead of 3. Every tag name is somebody's.
   *
   * Registering none costs the DOM-parse path only. A marker copied INSIDE the
   * editor survives because ProseMirror's clipboard carries its own slice
   * JSON, and a marker pasted as Markdown survives because `MarkdownPaste`
   * re-parses `[^1]`. What is lost is pasting this app's own exported HTML
   * back in and recovering markers from it — a narrow loss, and a far smaller
   * one than breaking raw-HTML preservation for a whole tag.
   *
   * Widening the computation to ignore attribute-filtered rules was measured
   * and rejected as out of scope: it would unclaim `a`, `img` and `span`,
   * changing round-trip behaviour for constructs V never touches.
   */
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'bear-footnote-ref' }];
  },

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, tr, dispatch }) => {
          const refType = state.schema.nodes.footnoteRef;
          const definitionType = state.schema.nodes.footnoteDefinition;
          if (refType === undefined || definitionType === undefined) return false;

          const label = nextLabel(state.doc);
          const at = state.selection.from;

          // After the LAST existing footnote, or at the end of the note when
          // there is none, so the section stays one contiguous run.
          let definitionAt = state.doc.content.size;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'footnoteDefinition') return true;
            definitionAt = pos + node.nodeSize;
            return false;
          });

          if (!dispatch) return true;

          tr.insert(at, refType.create({ label }));
          // Mapped, not reused: inserting the marker shifted everything after
          // it, and the footnote almost always sits after the caret.
          const mapped = tr.mapping.map(definitionAt);
          tr.insert(mapped, definitionType.create({ label }));
          tr.setSelection(TextSelection.create(tr.doc, mapped + 1));
          tr.scrollIntoView();

          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // `Mod-Alt-f` is the fold toggle; `Mod-Alt-6` is free, and the digit is a
    // weak mnemonic for a numbered note.
    return { 'Mod-Alt-6': () => this.editor.commands.insertFootnote() };
  },

  markdownTokenName: 'footnoteRef',

  markdownTokenizer: {
    name: 'footnoteRef',
    level: 'inline',
    start: (src: string) => src.indexOf('[^'),
    tokenize: (src: string) => {
      const match = REF.exec(src);
      if (!match) return undefined;
      return { type: 'footnoteRef', raw: match[0], label: match[1] };
    },
  },

  parseMarkdown: (token: MarkdownToken) => ({
    type: 'footnoteRef',
    attrs: { label: labelOf(token) },
  }),

  renderMarkdown: (node: JSONContent) => `[^${String(node.attrs?.label ?? '')}]`,
});

/**
 * `[^label]: text` — the footnote itself.
 *
 * An ordinary editable block, which is the whole design: the document is the
 * note, so a footnote is edited by typing in it rather than through a popover
 * whose contents the app would have to reconcile with the file.
 *
 * `inline*`, not `block+`: multi-paragraph definitions are an explicit
 * non-goal, and the tokenizer's `[^\n]*` enforces it at the source rather than
 * leaving a shape the schema accepts but the parser never produces.
 */
export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-footnote-def') ?? '',
        renderHTML: (attributes) => ({ 'data-footnote-def': attributes.label as string }),
      },
    };
  },

  /**
   * `p` is claimed WHOLESALE by `paragraph` already, so this rule adds no tag
   * to `computeRecognizedHtmlTags`' set and nothing is taken away from
   * `RawBlock`. That is the only reason the definition can keep a `parseHTML`
   * rule where the marker above cannot.
   */
  parseHTML() {
    return [{ tag: 'p[data-footnote-def]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', { ...HTMLAttributes, class: 'bear-footnote-def' }, 0];
  },

  markdownTokenName: 'footnoteDefinition',

  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block',
    /**
     * Reports only a position where a definition could ACTUALLY begin — the
     * start of a line, with a closing `]:` present.
     *
     * A block tokenizer's `start` is not a hint: marked uses it to CUT the
     * current paragraph short. Reporting every `[^`, the way an inline
     * tokenizer legitimately can, split `Alpha[^why] beta.` into two
     * paragraphs at the marker — so a sentence containing a footnote grew a
     * line break on every save, with the tokenizer then declining the
     * fragment. Round-tripping `Alpha[^why] and beta[^when].` is what caught
     * it.
     */
    start: (src: string) => {
      const match = /(?:^|\n)\[\^[^\]\s^]+\]:/.exec(src);
      // -1, never `undefined`: marked's type for a block `start` is `number`,
      // and `Highlight.ts`'s inline tokenizer reports absence the same way.
      if (match === null) return -1;
      return src[match.index] === '\n' ? match.index + 1 : match.index;
    },
    tokenize: (
      src: string,
      _tokens: unknown,
      lexer: { inlineTokens: (text: string) => MarkdownToken[] },
    ) => {
      const match = DEFINITION.exec(src);
      if (!match) return undefined;
      const text = match[2] ?? '';
      return {
        type: 'footnoteDefinition',
        raw: match[0],
        label: match[1],
        text,
        tokens: lexer.inlineTokens(text),
      };
    },
  },

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
    helpers.createNode(
      'footnoteDefinition',
      { label: labelOf(token) },
      helpers.parseInline(token.tokens ?? []),
    ),

  renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) =>
    `[^${String(node.attrs?.label ?? '')}]: ${helpers.renderChildren(node.content ?? [])}`,
});
