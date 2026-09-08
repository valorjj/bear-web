import { Extension } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { normalizeTag } from '@/data';
import { Hash, renderIconMarkup } from '@/ui/Icon';

import { MASK, maskedBlockText } from './blockText';
import { tagHitsIn } from './TagPill';

/** No result list is ever longer than this. Prefix and substring matching
 * only, deliberately — the same ruling `LinkAutocomplete`'s `matchingTitles`
 * rests on: a fuzzy ranker is a tuning problem with no end. */
export const MAX_RESULTS = 8;

export interface TagAutocompleteMatch {
  /** Document position of the opening `#`. */
  from: number;
  /** Document position of the caret, one past the last typed character. */
  to: number;
  /** The typed tag text, without the leading `#`. */
  query: string;
}

/** Whitespace, a masked character, or the edge of the block — the same
 * boundary set `parseTags`' own `isBoundary` uses. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === MASK || /\s/.test(ch);
}

/**
 * The live, unclosed tag immediately before the caret, or `null`.
 *
 * Walks the same shape of guard as `linkAutocompleteMatchAt`, and reuses
 * `maskedBlockText` for the same two reasons: masking turns an inline-code
 * span's characters into `MASK`, so a literal `#work` inside backticks cannot
 * open this list, and the one-character-per-position invariant keeps
 * `parentOffset` a valid index into the masked string with no separate offset
 * arithmetic for non-text children.
 *
 * The rule that differs from the link grammar is the REQUIRED BOUNDARY AFTER
 * THE CARET, and it does three jobs at once. It refuses `#wo|rk`, where
 * accepting a suggestion would replace `#wo` and strand `rk`. It excludes the
 * multi-word form `#a b#` by construction rather than by a guard, because
 * whitespace is a boundary. And it leaves the repair path intact, because
 * deleting-to-the-end is how a mistyped tag is fixed.
 */
export function tagAutocompleteMatchAt(state: EditorState): TagAutocompleteMatch | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  // The same two-fold guard `tagRangeAt` documents: rejects everywhere this
  // grammar cannot apply, and keeps `before()` below from throwing at depth 0,
  // where the parent is the document itself.
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;

  const text = maskedBlockText($from.parent);
  const before = text.slice(0, $from.parentOffset);
  const openAt = before.lastIndexOf('#');
  if (openAt === -1) return null;

  // `canStart` in the real parser: a tag begins at the block start or after
  // whitespace, never mid-word and never after a mask.
  const preceding = openAt === 0 ? undefined : before[openAt - 1];
  if (preceding !== undefined && !/\s/.test(preceding)) return null;

  const query = before.slice(openAt + 1);
  // At least one character, which keeps this out of the way of the `# `
  // heading input rule. A second `#` would be the multi-word form's closer,
  // which this control does not offer.
  if (query === '' || query.includes(MASK) || query.includes('#')) return null;
  if (/\s/.test(query)) return null;

  // The caret must sit at the tag's END. See the docblock above.
  if (!isBoundary(text[$from.parentOffset])) return null;

  // Not a tag at all (`#.`, `#!/bin/sh`), so there is nothing to complete.
  if (normalizeTag(query) === null) return null;

  const blockStart = $from.before() + 1;
  return { from: blockStart + openAt, to: blockStart + before.length, query };
}

/**
 * The rows to show for `query`: the typed text first, then existing tags.
 *
 * Row 0 is ALWAYS the query itself, and that is the load-bearing difference
 * from `matchingTitles`. Matching is substring-anywhere, so the
 * highest-ranked existing tag is routinely unrelated to what the user is
 * typing (`#a` matches `bear`); with existing tags ranked first, accepting
 * the default would silently rewrite `#a` to `#bear`. Row 0 stands for the
 * tag the text will produce, so an exact existing match dedupes INTO it
 * rather than appearing twice.
 *
 * `keys` are already normalized: `noteTags.tag` is written through
 * `normalizeTag`, and the synthesized ancestors Task 3 adds are built by
 * splitting an already-normalized key.
 *
 * A query ending in `/` narrows to that tag's subtree — see `prefix` below.
 */
export function matchingTags(keys: readonly string[], query: string): string[] {
  const q = normalizeTag(query);
  if (q === null) return [query];

  // A TRAILING SLASH means "show me what is under this tag", so the string
  // matched against is the slash-terminated path rather than the normalized
  // key it trims to. `normalizeTag('a/')` is `'a'` — the parser strips
  // trailing slashes — so without this, `#a/` would behave exactly like `#a`
  // and offer `assets/sap` and `bear` again instead of `a/b` and `a/c`. This
  // is what makes descend-and-stay-open show descendants: accepting `a/b`
  // leaves the caret after it, and typing `/` then narrows to that subtree.
  const prefix = query.endsWith('/') ? `${q}/` : q;

  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const key of keys) {
    // Deduped against row 0 on the NORMALIZED key, not on `prefix`: typing
    // `#work` must not list `work` twice, and typing `#a/` must not list the
    // parent `a` at all when what was asked for is its children.
    if (key === q) continue;
    if (key.startsWith(prefix)) startsWith.push(key);
    else if (key.includes(prefix)) contains.push(key);
  }
  startsWith.sort();
  contains.sort();

  return [query, ...startsWith, ...contains].slice(0, MAX_RESULTS);
}

export interface TagAutocompleteOptions {
  /**
   * `null` when nobody supplied them — the state of the schema-only
   * `editorExtensions` constant — and in that state NO PLUGIN is registered
   * at all, the same contract `LinkAutocompleteOptions.linkAutocompleteLabels`
   * and `TableHandlesOptions.labels` carry. A control with blank text would
   * be worse than no control.
   *
   * There is no `empty` label, unlike the link popover's: row 0 is always the
   * typed text, so an empty list is unreachable.
   */
  tagAutocompleteLabels: { listLabel: string } | null;
}

export const tagAutocompleteKey = new PluginKey<TagAutocompleteState>('tagAutocomplete');

interface TagAutocompleteState {
  /** Normalized tag keys from the tag index, pushed by `RichEditor`. */
  indexed: readonly string[];
  /**
   * Tags found in the OPEN DOCUMENT, plus their synthesized ancestors.
   *
   * Cached rather than recomputed per keystroke, and keyed on the `from` of
   * the tag being typed: a full-document tag parse is O(doc), and the
   * document's tag set does not meaningfully change while one tag is being
   * typed. `parseTags` has a measured quadratic history here (a 900 KB line
   * of `'#a '` took 2.1s before it was fixed), so a per-keystroke whole-note
   * parse is not a cost to take casually.
   */
  docKeys: readonly string[];
  docKeysFrom: number | null;
  /** The keyboard-highlighted row, before clamping to the row count. */
  activeIndex: number;
  /**
   * The `from` of the match that last OPENED the list on a document change,
   * or `null`. `openRows` requires this to equal the current match's `from`
   * before it will show anything, which is what stops a caret-only move from
   * ever opening (or keeping open) a list keyed to wherever the caret used to
   * be.
   *
   * Without this, `tagAutocompleteMatchAt` alone decided whether the list was
   * open — and that function is deliberately POSITIONAL, with no memory of
   * whether the caret arrived by typing or by merely moving there. Two
   * `ArrowDown`s to select row 2 on one tag, followed by a caret-only move to
   * the END of an unrelated, already-complete tag elsewhere in the note,
   * would still see `match !== null` there (the caret rests right after a
   * tag) and would render THAT tag's own row 2 as "active" — so `Tab` there
   * replaced the second tag with row 2's suggestion, silently rewriting text
   * the user never touched. Reported as Critical in Task 3's review: two
   * arrow keys and a Tab, with no typing at all, rewrote `#work` to
   * `#workshop`.
   *
   * Set on `tr.docChanged` (to the new match's `from`, or `null` if none) and
   * cleared on `tr.selectionSet` with no doc change — a caret move alone
   * closes the list; only typing (or `undo`, which is itself a document
   * change) opens it. `insertTag`'s post-insert selection lands inside a doc
   * CHANGE, so descend-and-stay-open still works: the same transaction that
   * moves the caret is the one that sets `openFrom` to the reopened match's
   * `from`.
   *
   * It carries the DISMISSAL too, and there is deliberately no second field
   * for that. A `dismissedFrom` shipped alongside this one and was fully
   * redundant: it recorded the `from` Escape had closed, was compared against
   * the current match's `from`, and was cleared on every `docChanged` — which
   * is exactly what clearing `openFrom` and re-setting it on the next
   * document change already does. Escape and an accepted row 0 both clear
   * this instead, so "closed until you type again" has ONE representation
   * rather than two that must be kept in step. Verified by measurement, not
   * by reading: with the `dismiss` branch rewritten to clear `openFrom`, the
   * whole suite stayed green, and the Escape tests still fail when Escape is
   * made a no-op.
   */
  openFrom: number | null;
}

type Meta =
  | { type: 'keys'; keys: readonly string[] }
  | { type: 'move'; direction: 'next' | 'prev' | 'first' | 'last' }
  | { type: 'dismiss' };

/**
 * Every tag in the document, plus every ancestor of each.
 *
 * The ancestors matter: `parseTags` writes one `noteTags` row per exact tag,
 * so `a` exists only as a node `buildTagTree` synthesizes from `a/b`. A
 * suggestion list built from exact tags alone could never offer `#a`.
 */
function documentTagKeys(state: EditorState): string[] {
  const keys = new Set<string>();
  state.doc.descendants((node: Node, pos: number) => {
    // `spec.code` first: a code block IS a textblock, so the combined guard
    // would descend into its text for nothing.
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    for (const hit of tagHitsIn(node, pos)) {
      const segments = hit.tag.split('/');
      for (let i = 1; i <= segments.length; i += 1) keys.add(segments.slice(0, i).join('/'));
    }
    // A textblock has no textblock children, so there is nothing below to
    // descend into.
    return false;
  });
  return [...keys];
}

function allKeys(value: TagAutocompleteState): string[] {
  return [...new Set([...value.indexed, ...value.docKeys])];
}

function widgetKey(match: TagAutocompleteMatch, activeIndex: number): string {
  // The volatile parts of the popover's content are baked INTO the key rather
  // than left in a closure: `WidgetType.eq` matches two widgets sharing a
  // `key` WITHOUT re-invoking `toDOM`, so a key constant across keystrokes
  // would leave a stale list on screen. `HeadingFold`'s drop indicator keys
  // on `dropAt` for the same reason.
  return `tag-autocomplete-${match.from}-${match.query}-${activeIndex}`;
}

/** Stable across keystrokes typing the same tag, unlike `widgetKey`: these
 * are read back by the `view()` lifecycle to point `aria-activedescendant` at
 * a real element, which must not change out from under a screen reader
 * mid-selection the way the widget's rebuild-every-keystroke key deliberately
 * does. */
function listboxId(from: number): string {
  return `bear-tag-autocomplete-listbox-${from}`;
}

function optionId(from: number, index: number): string {
  return `bear-tag-autocomplete-option-${from}-${index}`;
}

function renderPopover(
  labels: NonNullable<TagAutocompleteOptions['tagAutocompleteLabels']>,
  matches: readonly string[],
  activeIndex: number,
  from: number,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'bear-tag-autocomplete';
  container.contentEditable = 'false';

  const popover = document.createElement('div');
  popover.className = 'bear-tag-autocomplete-popover';
  popover.contentEditable = 'false';

  const list = document.createElement('ul');
  list.id = listboxId(from);
  list.className = 'bear-tag-autocomplete-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', labels.listLabel);
  list.tabIndex = -1;

  matches.forEach((key, index) => {
    const item = document.createElement('li');
    item.id = optionId(from, index);
    item.setAttribute('role', 'option');
    item.setAttribute('data-tag-autocomplete-option', String(index));
    item.setAttribute('aria-selected', String(index === activeIndex));
    item.classList.toggle('is-active', index === activeIndex);

    const icon = document.createElement('span');
    icon.className = 'bear-tag-autocomplete-icon';
    icon.setAttribute('aria-hidden', 'true');
    // A ProseMirror widget cannot render React, which is why this goes
    // through `renderIconMarkup` rather than through `Icon`.
    icon.innerHTML = renderIconMarkup(Hash);
    item.append(icon);

    const text = document.createElement('span');
    text.textContent = key;
    item.append(text);

    list.appendChild(item);
  });

  popover.append(list);
  container.append(popover);
  return container;
}

/**
 * Replaces the typed tag with `#<key>` and leaves the caret at its end,
 * WITHOUT a trailing space — so `tagAutocompleteMatchAt` immediately matches
 * again and the popover reopens on that tag's descendants, with row 0 the
 * literal (the just-accepted tag) rather than a child — the document just
 * changed, and a document change always resets `activeIndex` to 0 so the
 * pre-selected row stays the safe one. Accepting THAT row again (a second
 * Tab) therefore commits and closes rather than descending; descending
 * another level needs an ArrowDown first, or typing `/`. A space commits
 * and closes at any depth.
 */
function insertTag(view: EditorView, match: TagAutocompleteMatch, key: string): void {
  const text = `#${key}`;
  const tr = view.state.tr.insertText(text, match.from, match.to);
  // Set explicitly rather than relying on selection mapping, because the
  // reopened popover's position depends on exactly where this lands.
  tr.setSelection(TextSelection.create(tr.doc, match.from + text.length));
  view.dispatch(tr);
  view.focus();
}

/** Accepting row 0 changes no text — it means "keep what I typed" — so all it
 * does is close the list by clearing `openFrom`, which keeps it closed until
 * the next document change rather than reopening on the tag the user just
 * settled on. Escape takes the same path. */
function commitTypedText(view: EditorView): void {
  view.dispatch(
    view.state.tr
      .setMeta(tagAutocompleteKey, { type: 'dismiss' })
      .setMeta(skipTrailingNodeMeta, true),
  );
}

function clampedActiveIndex(activeIndex: number, matchCount: number): number {
  if (matchCount === 0) return -1;
  return Math.max(0, Math.min(activeIndex, matchCount - 1));
}

/** The open popover's rows, or `null` when it is not open. The one place the
 * three "is it open" conditions live, so `decorations`, `handleKeyDown`,
 * `mousedown` and the aria mirror cannot drift apart. */
function openRows(
  state: EditorState,
): { match: TagAutocompleteMatch; rows: string[]; activeIndex: number } | null {
  const match = tagAutocompleteMatchAt(state);
  if (match === null) return null;

  const pluginState = tagAutocompleteKey.getState(state);
  if (pluginState === undefined) return null;
  // The list only ever opens on a document change, at the `from` that change
  // produced. A caret-only move to a DIFFERENT tag's boundary would otherwise
  // still satisfy `tagAutocompleteMatchAt` there — this is what stops that
  // from rendering (and `handleKeyDown` from acting on) a stale row carried
  // over from wherever the caret used to be. See `openFrom`'s docblock.
  if (pluginState.openFrom !== match.from) return null;

  const rows = matchingTags(allKeys(pluginState), match.query);
  return { match, rows, activeIndex: clampedActiveIndex(pluginState.activeIndex, rows.length) };
}

/**
 * Offers every matching tag while the user types one, so a tag never has to
 * be remembered exactly or spelled twice.
 *
 * A sibling of `LinkAutocomplete` rather than a refactor of it: the two now
 * differ in three of their four behaviours — the always-present literal row,
 * `Tab` rather than `Enter`, and descend-and-stay-open — so a shared core
 * would be mostly injected difference, and L2's rulings are attached to that
 * file's exact lines.
 *
 * An `Extension`, not a `Node`: it registers nothing in the schema and
 * mutates no document merely by existing.
 */
export const TagAutocomplete = Extension.create<TagAutocompleteOptions>({
  name: 'tagAutocomplete',

  addOptions() {
    return { tagAutocompleteLabels: null };
  },

  addCommands() {
    return {
      setTagAutocompleteKeys:
        (keys: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            // `skipTrailingNodeMeta` is load-bearing: this is a meta-only
            // transaction and `TrailingNode.appendTransaction` is not gated
            // on `docChanged`, so without it this inserts and autosaves a
            // spurious trailing paragraph into any note ending in a list, the
            // instant this command fires on mount.
            dispatch(
              tr
                .setMeta(tagAutocompleteKey, { type: 'keys', keys })
                .setMeta(skipTrailingNodeMeta, true),
            );
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { tagAutocompleteLabels } = this.options;
    if (tagAutocompleteLabels === null) return [];
    const labels = tagAutocompleteLabels;

    return [
      new Plugin<TagAutocompleteState>({
        key: tagAutocompleteKey,

        state: {
          init: () => ({
            indexed: [],
            docKeys: [],
            docKeysFrom: null,
            activeIndex: 0,
            openFrom: null,
          }),

          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(tagAutocompleteKey) as Meta | undefined;

            if (meta?.type === 'keys') return { ...value, indexed: meta.keys };
            if (meta?.type === 'dismiss') return { ...value, openFrom: null };

            if (meta?.type === 'move') {
              const match = tagAutocompleteMatchAt(newState);
              const rows = match === null ? [] : matchingTags(allKeys(value), match.query);
              if (rows.length === 0) return value;
              const count = rows.length;
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

            let next = value;

            // Refresh the document's tag keys when a DIFFERENT tag starts
            // being typed, never on every keystroke within one — see
            // `docKeys`' own docblock for the cost this avoids.
            const match = tagAutocompleteMatchAt(newState);
            if (match !== null && match.from !== value.docKeysFrom) {
              next = { ...next, docKeys: documentTagKeys(newState), docKeysFrom: match.from };
            } else if (match === null && value.docKeysFrom !== null) {
              next = { ...next, docKeysFrom: null };
            }

            // A fresh keystroke lands on row 0 — the typed text — never on a
            // stale index left over from before the list narrowed, and any
            // dismissal is forgotten so continuing to type reopens the list.
            //
            // `openFrom` moves in lockstep: a document change is the only
            // thing allowed to OPEN the list (or keep it open on a different
            // tag), set to wherever the match now sits, or `null` if there is
            // none. A caret-only move — no doc change, but the selection did
            // move — CLOSES it, which is what stops a stale `activeIndex`
            // from a completely different tag being rendered as "active" the
            // instant the caret happens to land after this one. See
            // `openFrom`'s own docblock for the bug this closes.
            if (tr.docChanged) {
              next = {
                ...next,
                activeIndex: 0,
                openFrom: match?.from ?? null,
              };
            } else if (tr.selectionSet) {
              next = { ...next, openFrom: null };
            }

            return next;
          },
        },

        props: {
          decorations(state) {
            const open = openRows(state);
            if (open === null) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.widget(
                open.match.to,
                () => renderPopover(labels, open.rows, open.activeIndex, open.match.from),
                { side: 1, ignoreSelection: true, key: widgetKey(open.match, open.activeIndex) },
              ),
            ]);
          },

          handleKeyDown(view, event) {
            const open = openRows(view.state);
            // Everything falls through when the popover is closed, which is
            // the whole of the `Tab` collision's resolution:
            // `@tiptap/extension-list-keymap` never stops seeing `Tab`
            // except while this list is open.
            if (open === null) return false;

            switch (event.key) {
              case 'Escape':
                commitTypedText(view);
                return true;

              case 'ArrowDown':
              case 'ArrowUp':
              case 'Home':
              case 'End': {
                if (open.rows.length === 0) return false;
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
                    .setMeta(tagAutocompleteKey, { type: 'move', direction })
                    .setMeta(skipTrailingNodeMeta, true),
                );
                return true;
              }

              case 'Tab': {
                const chosen = open.rows[open.activeIndex];
                if (chosen === undefined) return false;
                // Row 0 is the typed text, so accepting it changes nothing
                // and only closes the list; any other row is an existing tag
                // to insert and descend into.
                if (open.activeIndex === 0) commitTypedText(view);
                else insertTag(view, open.match, chosen);
                return true;
              }

              // `Enter` and `space` are deliberately absent. With row 0
              // pre-selected `Enter` has nothing to insert, so intercepting
              // it could only swallow a keystroke that means "new paragraph"
              // everywhere else; `space` is how a tag is committed.
              default:
                return false;
            }
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;

              const option = target?.closest<HTMLElement>('[data-tag-autocomplete-option]');
              if (option) {
                if (event.button !== 0) return false;
                event.preventDefault();

                const open = openRows(view.state);
                if (open === null) return true;

                const index = Number(option.getAttribute('data-tag-autocomplete-option'));
                const chosen = open.rows[index];
                if (chosen === undefined) return true;
                // Identical per-row behaviour to `Tab`, so a click and a
                // keypress on the same row cannot diverge.
                if (index === 0) commitTypedText(view);
                else insertTag(view, open.match, chosen);
                return true;
              }

              // A click anywhere else inside the widget must not fall through
              // and move the caret.
              if (target?.closest('.bear-tag-autocomplete')) {
                event.preventDefault();
                return true;
              }

              return false;
            },
          },
        },

        // Mirrors the open/active state onto `view.dom` as
        // `role`/`aria-expanded`/`aria-controls`/`aria-activedescendant`: the
        // editable-combobox pattern, applied to the ALREADY-FOCUSED host,
        // because this control has no input of its own to carry the ARIA.
        // Without it a keyboard user watches the list move with nothing a
        // screen reader can announce. `originalRole` is captured once so
        // closing restores whatever the host carried before.
        view(editorView) {
          const originalRole = editorView.dom.getAttribute('role');

          const clear = (view: EditorView): void => {
            if (originalRole === null) view.dom.removeAttribute('role');
            else view.dom.setAttribute('role', originalRole);
            view.dom.removeAttribute('aria-expanded');
            view.dom.removeAttribute('aria-controls');
            view.dom.removeAttribute('aria-activedescendant');
          };

          const sync = (view: EditorView): void => {
            const open = openRows(view.state);
            if (open === null) {
              clear(view);
              return;
            }

            view.dom.setAttribute('role', 'combobox');
            view.dom.setAttribute('aria-expanded', 'true');
            view.dom.setAttribute('aria-controls', listboxId(open.match.from));
            if (open.activeIndex >= 0) {
              view.dom.setAttribute(
                'aria-activedescendant',
                optionId(open.match.from, open.activeIndex),
              );
            } else {
              view.dom.removeAttribute('aria-activedescendant');
            }
          };

          sync(editorView);

          return {
            update: sync,
            destroy() {
              clear(editorView);
            },
          };
        },
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tagAutocomplete: {
      /**
       * Replaces the normalized tag keys this plugin suggests from.
       *
       * Fed from `AppShell`'s existing `useTagTree()` rather than a query of
       * this plugin's own: `notes.allTagRows()` is a full table scan, so a
       * second live query would double the sidebar's cost on every tag write,
       * and this plugin would then have to re-derive the tree's synthesized
       * ancestors itself.
       *
       * These are only half the suggestion source. The plugin unions them
       * with tags in the OPEN DOCUMENT (`docKeys`), because the index is
       * written by autosave — which is now deliberately HELD while the caret
       * sits inside a tag — so a tag typed moments ago is not in this list.
       */
      setTagAutocompleteKeys: (keys: string[]) => ReturnType;
    };
  }
}
