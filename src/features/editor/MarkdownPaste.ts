import { Extension } from '@tiptap/core';
import { Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { parseMarkdown } from './markdown';
import { decodeEntities, looksLikeMarkdown } from './pastedMarkdown';

export const markdownPasteKey = new PluginKey('markdownPaste');

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
 * Registered UNCONDITIONALLY, unlike `ImagePaste`. It has no options and no
 * callback: it depends on nothing but the clipboard and the schema, so there
 * is no "wired up or not" state to express — which is exactly what
 * `ImagePaste.onImage === null` exists for.
 *
 * `handlePaste`, not `handleDOMEvents.paste`, and that does real work.
 * `ImagePaste` claims image pastes through `handleDOMEvents.paste` and calls
 * `preventDefault`, and ProseMirror consults `handleDOMEvents` BEFORE
 * `handlePaste` — so an image paste never reaches this plugin. No duplicated
 * file-sniffing, and no ordering dependency between the two entries in
 * `buildEditorExtensions`. Verified by injection in `markdownPaste.test.ts`,
 * not inferred from ProseMirror's documentation.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
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

            const text = clipboard.getData('text/plain');
            if (text === '') return false;

            // A rich source offers both flavours. Plain text wins only when it
            // carries structure — otherwise ProseMirror's own HTML path runs,
            // so copying a paragraph with a link off a web page keeps the
            // link. See the spec's decision 2.
            const html = clipboard.getData('text/html');
            if (html !== '' && !looksLikeMarkdown(text)) return false;

            const doc = ProseMirrorNode.fromJSON(
              view.state.schema,
              parseMarkdown(decodeEntities(text)),
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
