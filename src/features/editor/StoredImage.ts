import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';

import { files, formatImageAlt, loadImageBlob, MAX_DISPLAY_WIDTH, storedImageId } from '@/data';

import { acquireObjectUrl, releaseObjectUrl } from '@/lib/objectUrls';

export interface StoredImageOptions {
  /**
   * What a missing file says, already translated. `null` leaves the box empty
   * rather than printing an untranslated key — the same rule every other
   * extension option here follows.
   */
  missingLabel: string | null;
}

/**
 * An image whose bytes live in this browser's IndexedDB.
 *
 * Claims `files/<id>.webp` and nothing else. `RawImage` still handles every
 * other destination, so a remote URL keeps rendering as its own monospace
 * source — deliberately, because a note that fetches from a third-party host
 * the moment it opens turns a pasted tracking pixel into a beacon. See
 * `docs/rulings/markdown-and-schema.md`.
 *
 * The two do NOT compete for the `image` token. Registering two extensions
 * with the same `markdownTokenName` leaves which one wins up to the manager's
 * iteration order, which is not a contract; instead `RawImage` owns the token
 * and BRANCHES, emitting a `storedImage` node when the destination matches.
 * This node still declares the token name so the manager knows how to
 * serialize it back.
 *
 * A plain-DOM node view rather than React: the src is not in the document — it
 * is resolved asynchronously out of IndexedDB — and every other in-editor
 * widget here (`HeadingFold`, `TableHandles`) is plain DOM too. A React view
 * for one `<img>` would need a portal and buy nothing.
 */
/** Where a keyboard resize starts when the image has no width yet. */
const DEFAULT_STEP_BASE = 640;

export const StoredImage = Node.create<StoredImageOptions>({
  name: 'storedImage',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { missingLabel: null };
  },

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-src') ?? '',
        renderHTML: (attributes) => ({ 'data-src': attributes.src as string }),
      },
      alt: {
        default: '',
        parseHTML: (element) => element.getAttribute('alt') ?? '',
        renderHTML: (attributes) => ({ alt: attributes.alt as string }),
      },
      /**
       * Display width in pixels, or `null` for "fill the column".
       *
       * Applied as a CSS width, never the HTML `width` attribute: a resize
       * moves the CSS one, and having both would leave two sources of truth
       * fighting over the same box.
       */
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-width');
          return raw === null ? null : Number(raw);
        },
        renderHTML: (attributes) =>
          attributes.width === null ? {} : { 'data-width': String(attributes.width) },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // The serialized form, used by copy/paste and by anything that walks the
    // document. The node view below is what a user actually sees.
    return ['img', { ...HTMLAttributes, class: 'bear-stored-image' }];
  },

  markdownTokenName: 'image',

  renderMarkdown: (node: { attrs?: { src?: string; alt?: string; width?: number | null } }) =>
    `![${formatImageAlt(node.attrs?.alt ?? '', node.attrs?.width ?? null)}](${node.attrs?.src ?? ''})`,

  /**
   * The width the keyboard steps from when none is set yet.
   *
   * The node view has no layout to measure in jsdom and the real column width
   * is not knowable from here, so the first keypress adopts a sensible size
   * and every later one is relative to it. 640 is the middle of the range the
   * editor's own measure allows.
   */
  addKeyboardShortcuts() {
    /** 10% of the current width, floored so a step is always visible. */
    const step = (from: number, direction: 1 | -1): number => {
      const delta = Math.max(16, Math.round(from * 0.1));
      return Math.min(MAX_DISPLAY_WIDTH, Math.max(1, from + delta * direction));
    };

    const resize =
      (direction: 1 | -1 | 0) =>
      ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        const { selection } = state;
        // Only a selected IMAGE. Without this the chords would swallow
        // themselves whenever the caret sits in prose, which is most of the
        // time.
        if (!(selection instanceof NodeSelection)) return false;
        if (selection.node.type.name !== 'storedImage') return false;

        const current = (selection.node.attrs.width as number | null) ?? DEFAULT_STEP_BASE;
        // `null`, not 0: `formatImageAlt` omits the pipe entirely for null, so
        // a reset round-trips to exactly what an unresized image writes. `|0`
        // would parse back as no width anyway and is a different byte string.
        const next = direction === 0 ? null : step(current, direction);

        if (dispatch) {
          dispatch(
            state.tr.setNodeMarkup(selection.from, undefined, {
              ...selection.node.attrs,
              width: next,
            }),
          );
        }
        return true;
      };

    return {
      'Mod-Alt-ArrowRight': () => this.editor.commands.command(resize(1)),
      'Mod-Alt-ArrowLeft': () => this.editor.commands.command(resize(-1)),
      'Mod-Alt-0': () => this.editor.commands.command(resize(0)),
    };
  },

  addNodeView() {
    const { missingLabel } = this.options;

    const editor = this.editor;

    return ({ node, getPos }) => {
      const src = String(node.attrs.src ?? '');
      const id = storedImageId(src);

      const dom = document.createElement('span');
      dom.className = 'bear-stored-image-wrap';
      dom.contentEditable = 'false';

      if (id === null) {
        // Unreachable through `RawImage`'s branch, which only emits this node
        // for a matching path — but a pasted or imported document could carry
        // one, and a node view that throws takes the whole editor with it.
        dom.textContent = src;
        return { dom };
      }

      const image = document.createElement('img');
      image.alt = String(node.attrs.alt ?? '');
      image.className = 'bear-stored-image';

      // A CSS width, not the `width` ATTRIBUTE: the attribute is what the
      // record's own dimensions set below to reserve the box, and a display
      // width has to be able to override that without the two disagreeing.
      const displayWidth = node.attrs.width as number | null;
      if (displayWidth !== null) image.style.width = `${displayWidth}px`;
      // Reserved from the record below once it resolves. Until then the box is
      // empty rather than guessed: a wrong ratio reflows twice instead of once.
      dom.append(image);

      // The resize grip. Pointer-only by nature, which is why the keyboard
      // chords above exist — `docs/rulings/accessibility.md` records that a
      // pointer-only route to a real capability is a regression, not a
      // simplification. 44px because J2a's touch-target rule applies to every
      // new control, not only the ones a phone sees.
      const grip = document.createElement('span');
      grip.className = 'bear-image-grip';
      grip.setAttribute('contenteditable', 'false');
      grip.setAttribute('aria-hidden', 'true');
      dom.append(grip);

      grip.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        grip.setPointerCapture(event.pointerId);

        const startX = event.clientX;
        const startWidth = image.getBoundingClientRect().width;
        let live = startWidth;

        const onMove = (move: PointerEvent): void => {
          live = Math.min(
            MAX_DISPLAY_WIDTH,
            Math.max(1, Math.round(startWidth + (move.clientX - startX))),
          );
          // Live on the ELEMENT only. A width per pointer event would put a
          // hundred transactions — and a hundred sync-dirty marks — through
          // `notes.save` for one drag.
          image.style.width = `${live}px`;
        };

        const onUp = (): void => {
          grip.removeEventListener('pointermove', onMove);
          grip.removeEventListener('pointerup', onUp);
          grip.removeEventListener('pointercancel', onUp);

          // Written ONCE, on release. `getPos` rather than a captured
          // position: the node can move while the pointer is down if anything
          // else edits the document.
          const at = typeof getPos === 'function' ? getPos() : null;
          if (at === null || at === undefined) return;
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, width: live }),
          );
        };

        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
        grip.addEventListener('pointercancel', onUp);
      });

      let released = false;
      void (async () => {
        // `loadImageBlob` reads locally and, on a miss, asks the server once
        // (K2). `acquireObjectUrl` already de-duplicates in-flight loads, so
        // the editor and a list row wanting the same image make ONE request.
        const url = await acquireObjectUrl(id, loadImageBlob);

        // The view can be destroyed while the blob is in flight — a fast
        // scroll does it. Releasing here would decrement a count this view no
        // longer holds.
        if (released) {
          if (url !== null) releaseObjectUrl(id);
          return;
        }

        if (url === null) {
          image.remove();
          const missing = document.createElement('span');
          missing.className = 'bear-stored-image-missing';
          // NOT an error state. After K2 this is the ordinary appearance of an
          // image whose bytes have not synced yet, and building it as an error
          // now would mean rebuilding it then.
          missing.textContent = missingLabel ?? '';
          dom.append(missing);
          return;
        }

        const record = await files.get(id);
        if (record !== undefined && record.width > 0 && record.height > 0) {
          image.width = record.width;
          image.height = record.height;
        }
        image.src = url;
      })();

      return {
        dom,
        destroy() {
          released = true;
          releaseObjectUrl(id);
        },
      };
    };
  },
});
