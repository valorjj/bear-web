import { Node } from '@tiptap/core';

import { files, storedImageId } from '@/data';

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

  renderMarkdown: (node: { attrs?: { src?: string; alt?: string } }) =>
    `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''})`,

  addNodeView() {
    const { missingLabel } = this.options;

    return ({ node }) => {
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
      // Reserved from the record below once it resolves. Until then the box is
      // empty rather than guessed: a wrong ratio reflows twice instead of once.
      dom.append(image);

      let released = false;
      void (async () => {
        const url = await acquireObjectUrl(id, async (fileId) => {
          const record = await files.get(fileId);
          return record?.blob ?? null;
        });

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
