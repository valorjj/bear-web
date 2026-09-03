import { Extension } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import {
  containsFence,
  decodeEntities,
  htmlCarriesStructure,
  unwrapMarkdownFence,
} from './pastedMarkdown';

export const markdownPasteKey = new PluginKey('markdownPaste');

export interface MarkdownPasteOptions {
  /**
   * Parses pasted Markdown into a document. Injected rather than imported,
   * and that is load-bearing: `markdown.ts` builds its manager and schema
   * from `editorExtensions` at module top level, so importing it here closed
   * a cycle `extensions.ts -> MarkdownPaste.ts -> markdown.ts ->
   * extensions.ts`. Whichever module evaluated first re-entered the other
   * before its bindings existed, and the app failed to boot with
   * `editorExtensions` undefined. Every gate passed; only running the app
   * caught it.
   *
   * `null` when nobody supplied one — the state of the schema-only
   * `editorExtensions` constant. The plugin is then not registered at all and
   * the browser's own paste is untouched, the same rule `ImagePaste.onImage`
   * and `ContextMenuOptions.onOpen` both follow.
   *
   * Named `parsePastedMarkdown` rather than `parseMarkdown`: extension
   * options are a FLAT merge in `buildEditorExtensions`, so a colliding bare
   * name silently loses — `TableHandles.onOpenMenu` already collided with
   * `HeadingFold`'s once.
   */
  parsePastedMarkdown: ((markdown: string) => JSONContent) | null;
}

/**
 * How deeply open the pasted slice is at each end.
 *
 * A result that is exactly ONE paragraph inserts inline — open depth 1 — so
 * pasting `**bold**` into the middle of a sentence marks up the sentence
 * instead of splitting it in two. Anything else inserts as blocks.
 *
 * `paragraph` specifically, not `isTextblock`: pasting `## Hi` mid-sentence
 * should produce a heading, and open depth 1 would merge its text into the
 * surrounding paragraph and lose the heading entirely.
 */
function sliceFor(doc: ProseMirrorNode): Slice {
  const inline = doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph';
  return inline ? new Slice(doc.content, 1, 1) : new Slice(doc.content, 0, 0);
}

/**
 * Pasting Markdown into a note.
 *
 * The app IS Markdown — every note is loaded with `parseMarkdown` and saved by
 * serializing back — but until this existed there was no paste path into that
 * parser, so `**bold**` arrived as five literal characters and a table arrived
 * as one paragraph per row.
 *
 * Registered only when `parsePastedMarkdown` is supplied, exactly like
 * `ImagePaste.onImage`: with no parser there is nothing to paste THROUGH, so
 * the plugin stays out and the browser's own paste is untouched. The parser
 * is an injected option rather than an import because importing it closed an
 * initialisation cycle — see `MarkdownPasteOptions` above.
 *
 * `handlePaste`, not `handleDOMEvents.paste`, and that does real work.
 * `ImagePaste` claims image pastes through `handleDOMEvents.paste` and calls
 * `preventDefault`, and ProseMirror consults `handleDOMEvents` BEFORE
 * `handlePaste` — so an image paste never reaches this plugin, whatever order
 * the two sit in inside `buildEditorExtensions`. No duplicated file-sniffing,
 * and no ordering dependency between THOSE two entries. Verified by injection
 * in `markdownPaste.test.tsx`, not inferred from ProseMirror's documentation.
 *
 * But array position does NOT determine plugin order in general, and an
 * earlier version of this docblock claimed otherwise. `@tiptap/extension-code-
 * block`'s `codeBlockVSCodeHandler` is also a `handlePaste`, and although
 * `MarkdownPaste` sits LATER in the extensions array its plugin runs FIRST —
 * Tiptap's plugin order is its own, not the array's. So this plugin claimed
 * every VS Code paste and the language-tagged fenced block stopped happening.
 * That is why the fix is an explicit `vscode-editor-data` guard below rather
 * than a reordering: there is no array position that would have fixed it.
 */
export const MarkdownPaste = Extension.create<MarkdownPasteOptions>({
  name: 'markdownPaste',

  addOptions() {
    return { parsePastedMarkdown: null };
  },

  addProseMirrorPlugins() {
    const { parsePastedMarkdown } = this.options;
    if (parsePastedMarkdown === null) return [];

    return [
      new Plugin({
        key: markdownPasteKey,
        props: {
          handlePaste(view, event) {
            // ProseMirror synthesises a paste from a hidden element on
            // browsers that withhold `clipboardData`. Nothing to read, so
            // leave the event alone.
            const clipboard = event.clipboardData ?? null;
            if (clipboard === null) return false;

            // A code block takes clipboard text VERBATIM, and that is the
            // whole point of a code block. ProseMirror's own
            // `parseFromClipboard` has an `inCode` branch for this; claiming
            // the event bypasses it, so pasting a shell or YAML snippet into a
            // fence consumed its `#` and `-` as Markdown and split the block
            // in two. `spec.code` rather than a type-name check, so any
            // code-ish node this schema gains is covered.
            if (view.state.selection.$from.parent.type.spec.code === true) return false;

            // Copied out of VS Code (or another editor that sets this):
            // `@tiptap/extension-code-block`'s own paste handler turns it into
            // a fenced block tagged with the source language, which is
            // strictly better than parsing it as Markdown. Leave it alone.
            if (clipboard.getData('vscode-editor-data') !== '') return false;

            const text = clipboard.getData('text/plain');
            // `trim`, not `=== ''`: `'   '` and `'\n'` parse to one empty
            // paragraph, whose inline slice inserts nothing — so claiming the
            // event would silently swallow characters that landed before N. A
            // paste that would insert nothing must not be claimed.
            if (text.trim() === '') return false;

            // A ```` ```markdown ```` wrapper running to the end of the
            // payload is the SOURCE saying "this clipboard is a Markdown
            // document", so its two wrapper lines come off. Whether that
            // reading also OUTRANKS the source's own HTML is a separate
            // question, and it is decided by whether the unwrapped text
            // contains a fence of its own.
            const unwrapped = unwrapMarkdownFence(text);

            // THE PRECEDENCE RULE, and it resolves a real conflict between
            // two rules that are each correct alone: "HTML wins when it
            // declares structure" and "unwrap a markdown-tagged wrapper".
            //
            // An interior fence is what makes CommonMark's greedy close
            // destructive — and measured on the two real payloads, it is also
            // what makes the source's own HTML unreliable. Interior fence
            // lines: 2 in `fixtures/geminiAnswer.plain.txt`, whose HTML is
            // mangled in the same place as its plain text with the ASCII
            // diagram outside every `<pre>`; 0 in the two-flavour payload
            // `e2e/pasteMarkdown.spec.ts` pastes, whose HTML declares a real
            // `h2` and a real `table` against an ASCII-art plain flavour.
            //
            // So: with an interior fence, neither flavour is trustworthy and
            // the unwrap is the only faithful reading, so skip the HTML check
            // entirely. Without one, the wrapper was harmless — CommonMark
            // would have parsed the payload correctly anyway — and structural
            // HTML is the better reading, so let it win.
            if (unwrapped === null || !containsFence(unwrapped)) {
              // The source's own HTML beats re-parsing its plain-text
              // serialisation. See `htmlCarriesStructure`: a paragraph copied
              // off a web page has its link in the HTML and nothing in its
              // plain text. Plain-text Markdown parsing is for clipboards
              // that have no HTML at all — a Copy button, a terminal, a `.md`
              // file in a plain editor — which is the case that motivated
              // this whole feature.
              const html = clipboard.getData('text/html');
              if (html !== '' && htmlCarriesStructure(html)) return false;
            }

            // Falling through with a non-null `unwrapped` and no structural
            // HTML is the case that made this a precedence rule rather than a
            // third condition on the unwrap: a clean wrapper with no HTML
            // flavour at all still parses as the DOCUMENT it declares itself
            // to be, never as one code block.

            const doc = ProseMirrorNode.fromJSON(
              view.state.schema,
              parsePastedMarkdown(decodeEntities(unwrapped ?? text)),
            );

            // Through the view's own state and dispatch, NEVER
            // `editor.commands.*`: a command opens its own outer transaction,
            // and dispatching inside one throws `RangeError: Applying a
            // mismatched transaction`.
            view.dispatch(view.state.tr.replaceSelection(sliceFor(doc)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
