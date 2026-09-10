import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export interface ImagePasteOptions {
  /**
   * Called with each image the user pasted, dropped or chose from the file
   * picker. Returns the Markdown destination to insert, or `null` if the
   * image was refused — an oversized paste, or one this app cannot encode.
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

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imagePaste: {
      /** Store these images and insert them at the caret. The file picker's route in. */
      insertImageFiles: (files: File[]) => ReturnType;
    };
  }
}

export const imagePasteKey = new PluginKey('imagePaste');

/**
 * Set while a drag carrying files is over the editor, and read by
 * `editor.css` to draw the drop ring. An ATTRIBUTE rather than a class so the
 * rule reads as a state (`[data-drag-over]`) and cannot collide with
 * Tailwind's utilities on the same element.
 */
export const DRAG_OVER_ATTRIBUTE = 'data-drag-over';

/** Image files on a clipboard or drop payload, in the order the user gave them. */
function imagesFrom(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  return [...transfer.files].filter((file) => file.type.startsWith('image/'));
}

/**
 * Whether a drag is carrying FILES at all.
 *
 * Read from `types`, not from `files`, because during `dragover` the file
 * list is deliberately empty — the browser does not expose a drag's contents
 * until it is dropped. `types` is the only thing available that early, so it
 * is the only thing that can decide whether to show a drop affordance.
 * Dragging selected TEXT within the note carries `text/plain` and no `Files`,
 * and must not light the editor up.
 */
function carriesFiles(transfer: DataTransfer | null | undefined): boolean {
  return transfer != null && [...transfer.types].includes('Files');
}

/**
 * Stores each image and inserts it, at the position captured when the gesture
 * happened rather than at the live selection: storing is asynchronous, and by
 * the time it resolves the user may have clicked elsewhere.
 *
 * Shared by the paste handler, the drop handler and the `insertImageFiles`
 * command, so the file picker cannot drift from the other two.
 */
function insertImages(
  view: EditorView,
  files: File[],
  at: number,
  onImage: (file: Blob) => Promise<string | null>,
): boolean {
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
}

/**
 * Pasting, dropping or choosing an image into a note.
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

  addCommands() {
    return {
      /**
       * Deliberately the SAME route a paste or a drop takes. A second
       * implementation reading `onImage` itself and building its own node
       * would be a second pipeline to keep in step, and the two would differ
       * first in something invisible — where a refused image leaves the
       * caret, say.
       */
      insertImageFiles:
        (files: File[]) =>
        ({ view, state }: { view: EditorView; state: EditorState }): boolean => {
          const { onImage } = this.options;
          if (onImage === null || files.length === 0) return false;
          return insertImages(view, files, state.selection.from, onImage);
        },
    };
  },

  addProseMirrorPlugins() {
    const { onImage } = this.options;
    if (onImage === null) return [];

    /**
     * Nested drags fire `dragleave` on every child boundary crossed, so a
     * plain enter/leave pair flickers the ring off mid-drag whenever the
     * pointer passes over a paragraph, an image or a table cell. Counting
     * enters and leaves is what makes the state survive the crossing.
     */
    let depth = 0;

    const setRing = (view: EditorView, on: boolean): void => {
      if (on) view.dom.setAttribute(DRAG_OVER_ATTRIBUTE, 'true');
      else view.dom.removeAttribute(DRAG_OVER_ATTRIBUTE);
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
              return insertImages(view, files, view.state.selection.from, onImage);
            },

            dragenter(view, event) {
              if (!carriesFiles(event.dataTransfer)) return false;
              depth += 1;
              setRing(view, true);
              // `false`: the ring is decoration, and claiming the event would
              // take ProseMirror's own drag handling with it.
              return false;
            },

            dragover(view, event) {
              if (!carriesFiles(event.dataTransfer)) return false;
              // Without `preventDefault` on dragover the browser refuses the
              // drop outright and shows a "no entry" cursor over the one
              // target that accepts it.
              event.preventDefault();
              setRing(view, true);
              return false;
            },

            dragleave(view, event) {
              if (!carriesFiles(event.dataTransfer)) return false;
              depth = Math.max(0, depth - 1);
              if (depth === 0) setRing(view, false);
              return false;
            },

            drop(view, event) {
              depth = 0;
              setRing(view, false);
              const files = imagesFrom(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              // Dropped where the pointer is, not where the caret was — the
              // caret is wherever the user last typed, which is not where they
              // just aimed.
              const at =
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                view.state.selection.from;
              return insertImages(view, files, at, onImage);
            },
          },
        },
      }),
    ];
  },
});
