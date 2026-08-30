import { Extension, isMacOS } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { findLinkRanges, normalizeTitle } from '@/data';

import { maskedBlockText } from './blockText';

export interface LinkHit {
  /** The normalized title, exactly as `normalizeTitle` would report it. */
  title: string;
  /** Document position of the opening `[[`. */
  from: number;
  /** Document position one past the closing `]]`. */
  to: number;
}

/**
 * Every `[[…]]` in a textblock, as document positions.
 *
 * Mirrors `TagPill.ts`'s `tagHitsIn` exactly: `maskedBlockText` emits one
 * character per document position, so the character at index `i` inside a
 * block starting at `blockPos` sits at `blockPos + 1 + i`. `findLinkRanges`
 * runs its own `maskCode` pass over whatever string it's given, which is a
 * no-op here — the block text handed in has already replaced any inline code
 * span with `MASK` characters, so no backtick survives for it to find — but
 * calling it directly (rather than re-implementing the grammar) is what keeps
 * this one parser rather than two, the same discipline `tagHitsIn` follows
 * for `findTagRanges`.
 */
function linkHitsIn(node: Node, blockPos: number): LinkHit[] {
  return findLinkRanges(maskedBlockText(node)).map((range) => ({
    title: range.title,
    from: blockPos + 1 + range.start,
    to: blockPos + 1 + range.end,
  }));
}

/**
 * The link covering `pos`, or `null`.
 *
 * Deliberately independent of the decoration set, for the same reason
 * `tagRangeAt` is: a link the caret sits inside has no pill (see the
 * suppression rule in `linkDecorations`), and if activation hit-tested the
 * pills instead of the grammar, the same gesture would work or not work with
 * nothing on screen to explain the difference. Scans exactly one block, the
 * one containing `pos`, for the same constant-cost reason `tagRangeAt` does.
 */
export function linkRangeAt(state: EditorState, pos: number): LinkHit | null {
  const $pos = state.doc.resolve(pos);
  // Same two-fold load-bearing guard as `tagRangeAt`: rejects everything that
  // cannot hold a link, and keeps `before()` from throwing at depth 0, where
  // the parent is the document itself.
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;

  for (const hit of linkHitsIn($pos.parent, $pos.before())) {
    if (pos >= hit.from && pos <= hit.to) return hit;
  }
  return null;
}

export interface LinkPillOptions {
  /**
   * Called with the normalized title when the user Mod-clicks a link pill.
   * `null` when nobody is listening, which is the state of the schema-only
   * `editorExtensions` constant.
   *
   * Returns whether the app acted on the link, and that answer decides
   * whether the event is consumed — same contract as `TagPillOptions.onActivate`,
   * for the same reason: the plugin cannot know whether the target note
   * exists or has been trashed since the note list was last read, so it asks
   * first and consumes second. A link to a title with no matching note is a
   * normal way to work, not an error, and declining must cost the user
   * nothing but the filter — never the caret a plain click would have given.
   */
  onActivateLink: ((title: string) => boolean) | null;
  /**
   * Tooltip naming the gesture. Supplied already translated and already
   * platform-correct, exactly like `TagPillOptions.activateHint` — an
   * extension has no access to `useT`.
   */
  linkActivateHint: string | null;
}

// Not exported: nothing outside this file needs to target this plugin by
// key except this module's own commands and tests, which import it directly.
// The plugin's own state is the live set of known normalized note titles —
// see the module docblock on `setKnownNoteTitles` for why this rides plugin
// state instead of an option.
const linkPillKey = new PluginKey<ReadonlySet<string>>('linkPill');

/** The known-titles set currently held in plugin state, or empty if unmounted. */
export function knownNoteTitles(state: EditorState): ReadonlySet<string> {
  return linkPillKey.getState(state) ?? new Set();
}

/**
 * Renders `[[title]]` as a pill.
 *
 * A decoration, never a mark, for the same reason as `TagPill`: the document
 * is untouched, so no schema, serializer or round-trip path is involved, and
 * a pill can never survive into a note's Markdown. `linkPill.test.ts` is the
 * only thing that can catch a dead plugin.
 *
 * Resolution is read from `knownTitles`, a set of ALREADY-NORMALIZED titles —
 * never from a database lookup here, so this function stays synchronous and
 * pure over its inputs, matching `tagDecorations`'s shape.
 */
export function linkDecorations(
  state: EditorState,
  knownTitles: ReadonlySet<string>,
  focused = true,
  activateHint: string | null = null,
): Decoration[] {
  const decorations: Decoration[] = [];
  const { from: selFrom, to: selTo } = state.selection;

  state.doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    for (const hit of linkHitsIn(node, pos)) {
      const { from, to } = hit;
      // Same suppression rule as `tagDecorations`: a link the cursor sits
      // inside keeps its plain text so character widths do not jump while
      // it's being typed or edited. Intersection, not containment.
      if (focused && selFrom <= to && selTo >= from) continue;

      const resolved = knownTitles.has(hit.title);
      const attrs: Record<string, string> = {
        class: 'bear-link',
        'data-resolved': String(resolved),
      };
      if (activateHint !== null) attrs.title = activateHint;
      decorations.push(Decoration.inline(from, to, attrs));
    }
    return false;
  });

  return decorations;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkPill: {
      /**
       * Replaces the known-title set the plugin resolves pills against.
       * `titles` are raw note titles; each is normalized here, so the
       * caller (`RichEditor`, from `notes.allNoteTitles()`) never has to.
       */
      setKnownNoteTitles: (titles: string[]) => ReturnType;
    };
  }
}

export const LinkPill = Extension.create<LinkPillOptions>({
  name: 'linkPill',

  addOptions() {
    return {
      onActivateLink: null,
      linkActivateHint: null,
    };
  },

  addCommands() {
    return {
      setKnownNoteTitles:
        (titles: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            // `skipTrailingNodeMeta` (from `@tiptap/extensions`, the same
            // constant StarterKit's own `TrailingNode` reads) is load-bearing,
            // not decoration: `TrailingNode`'s `appendTransaction` runs after
            // EVERY dispatched transaction, meta-only or not — it is not
            // gated on `docChanged` — and inserts a trailing empty paragraph
            // whenever the document's last node is a type that needs one
            // (a list, a table, …). A note stored ending in such a node,
            // opened and closed with no user edit, would otherwise pick up
            // that paragraph the instant this command fires (typically on
            // mount, once the title query resolves) and autosave it back —
            // exactly the write `NoteEditor.test.tsx`'s "manager/schema
            // agreement" suite exists to catch. Without this meta, that
            // suite failed on two of its ten fixtures the moment this command
            // was wired into `RichEditor`'s mount effect.
            dispatch(
              tr
                .setMeta(linkPillKey, new Set(titles.map(normalizeTitle)))
                .setMeta(skipTrailingNodeMeta, true),
            );
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    // Captured once, not read as `this.editor`/`this.options` inside the
    // props below, for the same reason `TagPill` captures them this way:
    // both props are invoked by ProseMirror's view machinery with no
    // guarantee of `this` binding to the extension instance.
    const { editor } = this;
    const { onActivateLink, linkActivateHint } = this.options;
    return [
      new Plugin<ReadonlySet<string>>({
        key: linkPillKey,

        state: {
          init: () => new Set(),
          // The set is REPLACED wholesale by `setKnownNoteTitles`'s meta,
          // never merged — a stale title (a note renamed or trashed since
          // the last refresh) must stop resolving, not linger.
          apply(tr, value) {
            const meta = tr.getMeta(linkPillKey) as ReadonlySet<string> | undefined;
            return meta ?? value;
          },
        },

        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              linkDecorations(state, knownNoteTitles(state), editor.isFocused, linkActivateHint),
            );
          },

          handleDOMEvents: {
            // `mousedown`, not `handleClick`, for the identical reason
            // `TagPill` documents: the browser moves the DOM selection
            // natively during mousedown, and by `handleClick` (mouseup) the
            // caret has already moved and the pill has already vanished.
            mousedown(view, event) {
              if (onActivateLink === null) return false;
              if (event.button !== 0) return false;
              // Mod is Cmd on Apple platforms and Ctrl elsewhere, never
              // `metaKey || ctrlKey` — Ctrl-click on macOS is the
              // context-menu gesture and must not also activate a link.
              if (!(isMacOS() ? event.metaKey : event.ctrlKey)) return false;

              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (at === null) return false;

              const hit = linkRangeAt(view.state, at.pos);
              if (hit === null) return false;

              // Ask first, consume second — a Mod-click either opens the
              // target, or behaves exactly like a plain click. Never
              // nothing. A plain click must still place the caret.
              if (!onActivateLink(hit.title)) return false;

              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
