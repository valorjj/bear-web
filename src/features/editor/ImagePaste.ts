import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface ImagePasteOptions {
  /**
   * Called with each image the user pasted or dropped. Returns the Markdown
   * destination to insert, or `null` if the image was refused — an oversized
   * paste, or one this app cannot encode.
   *
   * `null` (the option, not the return) when nobody is listening, which is the
   * state of the schema-only `editorExtensions` constant. In that state the
   * plugin is not registered at all and the browser's own paste is untouched —
   * the same rule `ContextMenuOptions.onOpen` and `TagPillOptions.onActivate`
   * both follow, because an affordance that silently swallows a paste and does
   * nothing is worse than no affordance.
   *
   * Named `onImage` rather than `onPaste`: `buildEditorExtensions` spreads
   * every extension's options into ONE object, so a colliding name silently
   * loses — `TableHandles.onOpenMenu` already collided with `HeadingFold`'s.
   */
  onImage: ((file: Blob) => Promise<string | null>) | null;
}

export const imagePasteKey = new PluginKey('imagePaste');

/** Image files on a clipboard or drop payload, in the order the user gave them. */
function imagesFrom(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  return [...transfer.files].filter((file) => file.type.startsWith('image/'));
}

/**
 * Pasting or dropping an image into a note.
 *
 * An event source that hands files UP through a callback, exactly like
 * `ContextMenu`: the extension knows nothing about notes, IndexedDB or
 * downscaling, and `NoteEditor` — which owns the note id — does the storing
 * and hands back the path to insert.
 */
export const ImagePaste = Extension.create<ImagePasteOptions>({
  name: 'imagePaste',

  addOptions() {
    return { onImage: null };
  },

  addProseMirrorPlugins() {
    const { onImage } = this.options;
    if (onImage === null) return [];

    /**
     * Inserts at the position captured when the event fired, not at the live
     * selection: storing an image is asynchronous, and by the time it resolves
     * the user may have clicked elsewhere.
     */
    const handle = (
      view: import('@tiptap/pm/view').EditorView,
      files: File[],
      at: number,
    ): boolean => {
      void (async () => {
        let insertAt = at;
        for (const file of files) {
          const path = await onImage(file);
          if (path === null) continue;

          // A NODE, not the literal characters. `insertText('![](…)')` puts
          // Markdown syntax into a text node, and serializing a text node
          // escapes it — the document round-trips to `!\[\](files/…)`, which
          // is a broken reference that renders as source. Caught by the round
          // trip, which is what that test is for.
          const type = view.state.schema.nodes.storedImage;
          if (type === undefined) continue;

          // Through the view's own state and dispatch, NEVER
          // `editor.commands.*`: a command opens its own outer transaction, and
          // dispatching inside one throws `RangeError: Applying a mismatched
          // transaction`. Found wiring the table handle menu.
          const { tr } = view.state;
          const position = Math.min(insertAt, view.state.doc.content.size);
          view.dispatch(tr.insert(position, type.create({ src: path, alt: '' })));
          insertAt = position + 1;
        }
      })();

      return true;
    };

    return [
      new Plugin({
        key: imagePasteKey,
        props: {
          handleDOMEvents: {
            paste(view, event) {
              const files = imagesFrom(event.clipboardData);
              // No images: return false so pasting TEXT still pastes text.
              // Claiming every paste is the easy regression here.
              if (files.length === 0) return false;
              event.preventDefault();
              return handle(view, files, view.state.selection.from);
            },
            drop(view, event) {
              const files = imagesFrom(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              // Dropped where the pointer is, not where the caret was — the
              // caret is wherever the user last typed, which is not where they
              // just aimed.
              const at =
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                view.state.selection.from;
              return handle(view, files, at);
            },
          },
        },
      }),
    ];
  },
});
