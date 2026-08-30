import { Extension } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { normalizeTitle } from '@/data';

import { MASK, maskedBlockText } from './blockText';

/** No result list is ever longer than this. Prefix and substring matching
 * only, deliberately — a fuzzy ranker is a tuning problem with no end, and
 * the L2 spec rules it out. */
const MAX_RESULTS = 8;

export interface LinkAutocompleteOptions {
  /**
   * `null` when nobody supplied them — the state of the schema-only
   * `editorExtensions` constant — and in that state NO PLUGIN is registered
   * at all, exactly like `CodeLanguageControlsOptions.codeLabels` and
   * `TableHandlesOptions.labels`. A control with blank text would be worse
   * than no control.
   */
  linkAutocompleteLabels: { listLabel: string; empty: string } | null;
}

export const linkAutocompleteKey = new PluginKey<LinkAutocompleteState>('linkAutocomplete');

interface LinkAutocompleteState {
  /** Raw, exactly-cased note titles — see this module's own docblock on
   * `setLinkAutocompleteTitles` for why this is a SEPARATE copy from
   * `LinkPill`'s known-title set rather than a shared one. */
  titles: readonly string[];
  /** The keyboard-highlighted row, before clamping to however many rows the
   * current query actually matches. */
  activeIndex: number;
  /**
   * The `from` of the match Escape most recently dismissed, or `null`.
   * Compared against the CURRENT match's `from` (the position of its
   * opening `[[`, which stays fixed while the user keeps typing the same
   * link) so the list stays closed while that same bracket is being edited,
   * but reopens the moment the user resumes typing — `apply` below clears
   * this on any `docChanged` transaction.
   */
  dismissedFrom: number | null;
}

export interface LinkAutocompleteMatch {
  /** Document position of the opening `[`. */
  from: number;
  /** Document position of the caret, one past the last typed character. */
  to: number;
  /** Text typed since the opening `[[`, never containing `]` or a newline. */
  query: string;
}

/**
 * The unclosed `[[query` immediately before the caret, or `null` — this
 * plugin's equivalent of `codeBlockPosAt`/`linkRangeAt`, walking the same
 * shape of guard.
 *
 * Reuses `maskedBlockText`, exactly like `LinkPill.ts`'s `linkHitsIn`, rather
 * than re-scanning `node.textContent`: masking turns an inline-code span's
 * brackets into `MASK` characters, so a literal `` `[[` `` typed inside code
 * cannot open this list, and the one-character-per-position invariant keeps
 * `parentOffset` a valid index into the masked string with no separate
 * offset arithmetic for non-text children (a hard break, an image).
 */
export function linkAutocompleteMatchAt(state: EditorState): LinkAutocompleteMatch | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  // Same two-fold guard `linkRangeAt` uses: rejects everywhere this
  // grammar cannot apply, and keeps `before()` below from throwing at depth
  // 0, where the parent is the document itself.
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;

  const text = maskedBlockText($from.parent);
  const upto = text.slice(0, $from.parentOffset);
  const openAt = upto.lastIndexOf('[[');
  if (openAt === -1) return null;

  const query = upto.slice(openAt + 2);
  // A closing `]` (or the start of one), a newline, or a masked character
  // anywhere in the query means this is not a live, still-open link — mirrors
  // `findLinkRanges`'s `[^\]\n]*`, plus refusing to straddle a masked
  // boundary this grammar cannot see into.
  if (query.includes(']') || query.includes('\n') || query.includes(MASK)) return null;

  const blockStart = $from.before() + 1;
  return { from: blockStart + openAt, to: blockStart + upto.length, query };
}

/**
 * `titles` filtered to `query`, prefix matches before substring matches,
 * capped at `MAX_RESULTS` — never fuzzy-ranked.
 *
 * Matching runs on `normalizeTitle(title)` against `normalizeTitle(query)` —
 * the same case-fold-and-collapse-whitespace key `findLinkRanges`'s own
 * index uses — so `"deploy   checklist"` (typed with extra spaces) still
 * matches `"Deploy Checklist"`. The returned strings are the ORIGINAL,
 * exactly-cased titles: `insertLink` inserts one of these verbatim, never the
 * normalized key.
 */
export function matchingTitles(titles: readonly string[], query: string): string[] {
  const q = normalizeTitle(query);
  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const title of titles) {
    const key = normalizeTitle(title);
    if (key.startsWith(q)) startsWith.push(title);
    else if (key.includes(q)) contains.push(title);
  }
  return [...startsWith, ...contains].slice(0, MAX_RESULTS);
}

type Meta =
  | { type: 'titles'; titles: readonly string[] }
  | { type: 'move'; direction: 'next' | 'prev' | 'first' | 'last' }
  | { type: 'dismiss'; from: number };

function widgetKey(match: LinkAutocompleteMatch, activeIndex: number): string {
  // The volatile bits of the popover's content are baked INTO the key,
  // rather than left in a closure `decorations()` rebuilds every call:
  // `WidgetType.eq` (prosemirror-view) matches two widgets sharing a `key`
  // WITHOUT re-invoking `toDOM`, so a key that stayed constant across
  // keystrokes (e.g. keyed only on `match.from`, which does not move while
  // the same `[[` is being typed) would leave a stale list on screen —
  // `linkAutocomplete.test.ts` pins this. `HeadingFold.ts`'s drop-indicator
  // widget keys on `dropAt` for the identical reason: a volatile value baked
  // into the key, not mutated in place.
  return `link-autocomplete-${match.from}-${match.query}-${activeIndex}`;
}

function renderPopover(
  labels: NonNullable<LinkAutocompleteOptions['linkAutocompleteLabels']>,
  matches: readonly string[],
  activeIndex: number,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'bear-link-autocomplete';
  container.contentEditable = 'false';

  const popover = document.createElement('div');
  popover.className = 'bear-link-autocomplete-popover';
  popover.contentEditable = 'false';

  const list = document.createElement('ul');
  list.className = 'bear-link-autocomplete-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', labels.listLabel);
  list.tabIndex = -1;

  if (matches.length === 0) {
    list.hidden = true;
    const emptyEl = document.createElement('div');
    emptyEl.className = 'bear-link-autocomplete-empty';
    emptyEl.textContent = labels.empty;
    popover.append(list, emptyEl);
  } else {
    matches.forEach((title, index) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.setAttribute('data-link-autocomplete-option', String(index));
      item.setAttribute('aria-selected', String(index === activeIndex));
      item.classList.toggle('is-active', index === activeIndex);
      item.textContent = title;
      list.appendChild(item);
    });
    popover.append(list);
  }

  container.append(popover);
  return container;
}

/** Replaces `[[query` (the range `match.from`–`match.to`) with the exact
 * stored title, closed and bracketed. Never the typed query text — the
 * whole point of this control is offering a title the user does not have to
 * type (or spell) exactly. */
function insertLink(view: EditorView, match: LinkAutocompleteMatch, title: string): void {
  const tr = view.state.tr.insertText(`[[${title}]]`, match.from, match.to);
  view.dispatch(tr);
  view.focus();
}

/** The row `activeIndex` names, clamped to however many rows `matches`
 * actually holds — never negative, and `-1` only when there are none. */
function clampedActiveIndex(activeIndex: number, matchCount: number): number {
  if (matchCount === 0) return -1;
  return Math.max(0, Math.min(activeIndex, matchCount - 1));
}

/**
 * Offers the titles of existing notes while the user types `[[`, so linking
 * a note never requires remembering its exact title.
 *
 * Built like `CodeLanguageControls`, but simpler in one load-bearing way:
 * that control has its OWN filter input, a separate `contenteditable=false`
 * element that must itself hold DOM focus and therefore be mutated in place
 * across keystrokes rather than rebuilt. This one has no such input — the
 * "filter text" IS the document text the user is typing right into the main
 * editable surface, read back by `linkAutocompleteMatchAt` on every state
 * change — so its widget can simply be rebuilt fresh every keystroke (see
 * `widgetKey`) with no DOM to preserve.
 *
 * An `Extension`, not a `Node`: it registers nothing in the schema and
 * mutates no document merely by existing, so every Markdown round-trip test
 * is blind to whether it runs at all.
 */
export const LinkAutocomplete = Extension.create<LinkAutocompleteOptions>({
  name: 'linkAutocomplete',

  addOptions() {
    return { linkAutocompleteLabels: null };
  },

  addCommands() {
    return {
      setLinkAutocompleteTitles:
        (titles: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            // `skipTrailingNodeMeta` is load-bearing here for the identical
            // reason it is on `LinkPill.setKnownNoteTitles`: this is a
            // meta-only transaction, and `TrailingNode.appendTransaction` is
            // not gated on `docChanged` — without this tag it would insert
            // and autosave a spurious trailing paragraph into any note
            // ending in a list, the instant this command fires on mount.
            dispatch(
              tr
                .setMeta(linkAutocompleteKey, { type: 'titles', titles })
                .setMeta(skipTrailingNodeMeta, true),
            );
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { linkAutocompleteLabels } = this.options;
    if (linkAutocompleteLabels === null) return [];
    const labels = linkAutocompleteLabels;

    return [
      new Plugin<LinkAutocompleteState>({
        key: linkAutocompleteKey,

        state: {
          init: () => ({ titles: [], activeIndex: 0, dismissedFrom: null }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(linkAutocompleteKey) as Meta | undefined;

            if (meta?.type === 'titles') return { ...value, titles: meta.titles };

            if (meta?.type === 'dismiss') return { ...value, dismissedFrom: meta.from };

            if (meta?.type === 'move') {
              const match = linkAutocompleteMatchAt(newState);
              const matches = match === null ? [] : matchingTitles(value.titles, match.query);
              if (matches.length === 0) return value;
              const count = matches.length;
              let next: number;
              switch (meta.direction) {
                case 'next':
                  next = (value.activeIndex + 1) % count;
                  break;
                case 'prev':
                  next = (value.activeIndex - 1 + count) % count;
                  break;
                case 'first':
                  next = 0;
                  break;
                case 'last':
                  next = count - 1;
                  break;
              }
              return { ...value, activeIndex: next };
            }

            // A fresh keystroke: requirement is that it lands on the first
            // match, never a stale index left over from before the filter
            // narrowed the list — same rule `CodeLanguageControls.ts`'s
            // `renderOptions` follows for its own `preferredKey` — and any
            // dismissal is forgotten, so continuing to type reopens the
            // list rather than requiring the user to retrigger it.
            if (tr.docChanged) return { ...value, activeIndex: 0, dismissedFrom: null };

            return value;
          },
        },

        props: {
          decorations(state) {
            const match = linkAutocompleteMatchAt(state);
            if (match === null) return DecorationSet.empty;

            const pluginState = linkAutocompleteKey.getState(state);
            if (pluginState === undefined) return DecorationSet.empty;
            if (pluginState.dismissedFrom === match.from) return DecorationSet.empty;

            const matches = matchingTitles(pluginState.titles, match.query);
            const activeIndex = clampedActiveIndex(pluginState.activeIndex, matches.length);

            return DecorationSet.create(state.doc, [
              Decoration.widget(match.to, () => renderPopover(labels, matches, activeIndex), {
                side: 1,
                ignoreSelection: true,
                key: widgetKey(match, activeIndex),
              }),
            ]);
          },

          handleKeyDown(view, event) {
            const match = linkAutocompleteMatchAt(view.state);
            if (match === null) return false;

            const pluginState = linkAutocompleteKey.getState(view.state);
            if (pluginState === undefined) return false;
            if (pluginState.dismissedFrom === match.from) return false;

            const matches = matchingTitles(pluginState.titles, match.query);

            switch (event.key) {
              case 'Escape':
                view.dispatch(
                  view.state.tr
                    .setMeta(linkAutocompleteKey, { type: 'dismiss', from: match.from })
                    .setMeta(skipTrailingNodeMeta, true),
                );
                return true;

              case 'ArrowDown':
              case 'ArrowUp':
              case 'Home':
              case 'End': {
                if (matches.length === 0) return false;
                const direction =
                  event.key === 'ArrowDown'
                    ? 'next'
                    : event.key === 'ArrowUp'
                      ? 'prev'
                      : event.key === 'Home'
                        ? 'first'
                        : 'last';
                view.dispatch(
                  view.state.tr
                    .setMeta(linkAutocompleteKey, { type: 'move', direction })
                    .setMeta(skipTrailingNodeMeta, true),
                );
                return true;
              }

              case 'Enter': {
                if (matches.length === 0) return false;
                const activeIndex = clampedActiveIndex(pluginState.activeIndex, matches.length);
                const title = matches[activeIndex];
                if (title === undefined) return false;
                insertLink(view, match, title);
                return true;
              }

              default:
                return false;
            }
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;

              const option = target?.closest<HTMLElement>('[data-link-autocomplete-option]');
              if (option) {
                if (event.button !== 0) return false;
                event.preventDefault();

                const match = linkAutocompleteMatchAt(view.state);
                if (match === null) return true;
                const pluginState = linkAutocompleteKey.getState(view.state);
                if (pluginState === undefined) return true;

                const matches = matchingTitles(pluginState.titles, match.query);
                const index = Number(option.getAttribute('data-link-autocomplete-option'));
                const title = matches[index];
                if (title !== undefined) insertLink(view, match, title);
                return true;
              }

              // A click anywhere else inside the widget must not fall
              // through to the editor and move the caret — same catch-all
              // `CodeLanguageControls.ts`'s `mousedown` handler ends on.
              if (target?.closest('.bear-link-autocomplete')) {
                event.preventDefault();
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkAutocomplete: {
      /**
       * Replaces the raw, exactly-cased title list this plugin filters and
       * inserts from.
       *
       * A SEPARATE copy from `LinkPill`'s own known-title set, not a shared
       * one, even though both are fed from the same `notes.allNoteTitles()`
       * query result in `RichEditor` (one query, two commands dispatched
       * from the one effect — see that component). `LinkPill`'s set holds
       * titles already run through `normalizeTitle` (lower-cased,
       * whitespace-collapsed), because all it ever does is a membership
       * test. This plugin cannot reuse that set: `chooseActive` inserts a
       * title VERBATIM, and normalization is lossy — there is no way back
       * from `"deploy checklist"` to `"Deploy Checklist"`. Reusing the
       * query result rather than issuing a second `useLiveQuery` is what
       * keeps this from being a second, independently-staled source of
       * "what notes exist"; the SHAPE the two plugins keep in state still
       * has to differ.
       */
      setLinkAutocompleteTitles: (titles: string[]) => ReturnType;
    };
  }
}
