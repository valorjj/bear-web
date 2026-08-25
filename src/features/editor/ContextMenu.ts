import { Extension, posToDOMRect } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface ContextMenuRequest {
  /** Document position the menu acts on. */
  pos: number;
  /**
   * Viewport rectangle to anchor against — the click point as a zero-size
   * rect for a pointer open, the caret's own rect for a keyboard open.
   *
   * A rect rather than raw coordinates so the surface's flip/clamp arithmetic
   * is byte-identical to `HeadingMenu`'s, and so the keyboard opener (which
   * has no pointer position at all) feeds the same field.
   */
  rect: DOMRect;
}

export interface ContextMenuOptions {
  /**
   * `null` when nobody is listening, which is the state of the schema-only
   * `editorExtensions` constant — and in that state the plugin is not
   * registered at all, so the browser's own menu is untouched.
   *
   * Absent rather than inert, the same rule `TagPillOptions.onActivate` and
   * `TableControlsOptions.labels` both follow: an affordance that does nothing
   * is worse than no affordance, and here "does nothing" would mean silently
   * suppressing the browser menu and offering nothing in its place.
   */
  onOpen: ((request: ContextMenuRequest) => void) | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contextMenu: {
      /** Opens the menu at the caret. The keyboard route; returns false if unwired. */
      openContextMenu: () => ReturnType;
    };
  }
}

export const contextMenuKey = new PluginKey('contextMenu');

/**
 * The editor's right-click menu, as an event source only.
 *
 * The plugin owns the DOM event and hands a request UP through a callback
 * captured at construction; React draws the menu. A ProseMirror plugin has a
 * `view`, and therefore a `state`/`dispatch` pair, but no `Editor` — reaching
 * for one from in here would be the editor learning about the layer above it,
 * the boundary `TagPill.onActivate` and `HeadingFold.onOpenMenu` both keep.
 *
 * An `Extension`, not a `Node` or `Mark`: it registers nothing in the schema
 * and mutates no document, so every Markdown round-trip suite is blind to
 * whether it runs at all. `contextMenu.test.ts` is the only thing that can see
 * it.
 *
 * KNOWN COST, accepted deliberately: calling `preventDefault()` on
 * `contextmenu` also removes the browser's spellcheck suggestions, Look Up and
 * Services from the writing surface. There is no way to keep half of a native
 * menu.
 */
export const ContextMenu = Extension.create<ContextMenuOptions>({
  name: 'contextMenu',

  addOptions() {
    return { onOpen: null };
  },

  addKeyboardShortcuts() {
    return {
      // The two conventional keyboard routes to a context menu. Required by
      // `docs/rulings/accessibility.md`: the pointer route is the only other
      // one, and a keyboard user would otherwise have no path to these
      // commands at all.
      'Shift-F10': () => this.editor.commands.openContextMenu(),
      ContextMenu: () => this.editor.commands.openContextMenu(),
    };
  },

  addCommands() {
    const { onOpen } = this.options;
    return {
      openContextMenu:
        () =>
        ({ state, view }) => {
          if (onOpen === null) return false;
          const { from, to } = state.selection;
          onOpen({ pos: from, rect: posToDOMRect(view, from, to) });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    if (onOpen === null) return [];

    return [
      new Plugin({
        key: contextMenuKey,
        props: {
          handleDOMEvents: {
            contextmenu(view, event) {
              // Resolved from the pointer, NOT from the current selection: a
              // right-click does not move the caret in every browser, so
              // acting on the selection would target whatever the user last
              // clicked instead of what they just pointed at.
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const pos = at?.pos ?? view.state.selection.from;

              event.preventDefault();
              onOpen({
                pos,
                // A zero-size rect at the pointer. `HeadingMenu`'s flip/clamp
                // arithmetic reads `.top`, `.bottom`, `.left` and nothing
                // else, so a degenerate rect anchors the menu exactly at the
                // click point with no special case.
                rect: new DOMRect(event.clientX, event.clientY, 0, 0),
              });
              return true;
            },
          },
        },
      }),
    ];
  },
});
