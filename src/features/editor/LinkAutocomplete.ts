import { Extension } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { normalizeTitle, splitLinkTarget } from '@/data';
import { FileText, Heading, renderIconMarkup } from '@/ui/Icon';

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
  linkAutocompleteLabels: {
    listLabel: string;
    empty: string;
    headingListLabel: string;
    headingEmpty: string;
  } | null;
}

export const linkAutocompleteKey = new PluginKey<LinkAutocompleteState>('linkAutocomplete');

interface LinkAutocompleteState {
  /** Raw, exactly-cased note titles — see this module's own docblock on
   * `setLinkAutocompleteTitles` for why this is a SEPARATE copy from
   * `LinkPill`'s known-title set rather than a shared one. */
  titles: readonly string[];
  /**
   * Headings of one note, as fetched for the `/` mode, or `null` before any
   * fetch has landed.
   *
   * Rides plugin state rather than an option for the same reason `titles`
   * does — options are read once at construction — and carries its own
   * `title` so a result arriving late, after the reader has backspaced to a
   * different note, is ignored rather than listed under the wrong one.
   */
  headings: { title: string; rows: readonly string[] } | null;
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
  /**
   * Where a replacement must END so it does not leave stray brackets behind.
   *
   * Equal to `to` for a link still being typed. Two characters PAST `to` when
   * the caret sits immediately before this link's own `]]` — the state the
   * popover's own insert leaves behind, and the only way to add `/heading` to
   * a link it has already closed.
   */
  closeTo: number;
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

  const after = text.slice($from.parentOffset);

  // The caret sits INSIDE an already-complete `[[Title]]`. Nothing before the
  // caret can tell: the `]]` is on the far side of it, so every guard above
  // passes and the popover opens inside a finished link — where `Enter` runs
  // `insertLink`, which would replace `[[` → caret and leave the original tail
  // behind, yielding `[[Full Title]] Title]]`.
  //
  // ONE position is exempt, and it is the one sub-project U's own flow needs:
  // the caret immediately before this link's `]]`. That is where you land
  // after moving back into a link the popover itself closed, and typing `/`
  // there is the only way to turn `[[first note]]` into
  // `[[first note/Heading]]`. Reported from production on 2026-09-15, because
  // U shipped with the two halves of its own feature unable to meet.
  //
  // `insertLink` consumes those two characters via `closeTo`, so nothing is
  // left behind — the exact failure this guard was written for.
  //
  // Everything else still refuses, including the case the guard exists for: a
  // NEW link opened to the left of an existing one (`[[Be| and [[Alpha]]`)
  // sees a `]]` ahead that belongs to the OTHER link, and `after` does not
  // start with it. A caret mid-title (`[[first no|te]]`) refuses too —
  // conservative, and it costs the reader one arrow key.
  const closes = after.startsWith(']]');
  if (!closes && /^[^\]\n]*\]\]/.test(after)) return null;

  const blockStart = $from.before() + 1;
  const to = blockStart + upto.length;
  return { from: blockStart + openAt, to, query, closeTo: closes ? to + 2 : to };
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

/**
 * `headings` filtered to `query`, the same shape `matchingTitles` uses: prefix
 * matches before substring matches, capped, compared through `normalizeTitle`,
 * and returning the ORIGINAL casing so the inserted link reproduces the
 * heading exactly as written.
 *
 * Deliberately NOT merged with `matchingTitles` into one helper with a flag.
 * The two are eight lines each and identical today; a shared function that
 * grows a `mode` parameter the first time one of them needs to differ is
 * worse than two functions that can diverge honestly.
 */
export function matchingHeadings(headings: readonly string[], query: string): string[] {
  const q = normalizeTitle(query);
  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const heading of headings) {
    const key = normalizeTitle(heading);
    if (key.startsWith(q)) startsWith.push(heading);
    else if (key.includes(q)) contains.push(heading);
  }
  return [...startsWith, ...contains].slice(0, MAX_RESULTS);
}

export interface LinkRows {
  /** Which list the popover is showing. */
  mode: 'title' | 'heading';
  /** The rows themselves, exactly cased. */
  rows: string[];
  /** In heading mode, the target note's title, exactly as stored. */
  title: string | null;
}

/**
 * What the popover should list for a query — the ONE place that decision is
 * made, so the renderer, the keyboard handler, the click handler and the
 * active-index clamp cannot disagree about how many rows exist.
 *
 * The `/` rule itself is not re-implemented here: `splitLinkTarget` owns it,
 * and `allowEmptyHeading` is what makes `Deploy Checklist/` — slash typed, no
 * filter yet — mean "that note's headings" rather than an unresolved whole.
 *
 * Heading mode with no fetched headings yet yields NO rows rather than
 * falling back to titles. Falling back would flash the note list for one
 * frame every time the reader types a slash, and then replace it.
 */
export function linkRowsFor(
  titles: readonly string[],
  headings: { title: string; rows: readonly string[] } | null,
  query: string,
): LinkRows {
  const byKey = new Map(titles.map((title) => [normalizeTitle(title), title]));
  const target = splitLinkTarget(query, (candidate) => byKey.has(candidate), {
    allowEmptyHeading: true,
  });

  if (target.heading === null) {
    return { mode: 'title', rows: matchingTitles(titles, query), title: null };
  }

  const exact = byKey.get(target.title) ?? null;
  const loaded = headings !== null && headings.title === target.title ? headings.rows : null;
  return {
    mode: 'heading',
    rows: loaded === null ? [] : matchingHeadings(loaded, target.heading),
    title: exact,
  };
}

/**
 * The normalized title whose headings the popover needs right now, or `null`.
 *
 * `RichEditor` watches this to decide when to fetch. It deliberately reports
 * the title even when headings for it are already loaded: the effect that
 * consumes it keys on the value, so an unchanged title re-fetches nothing.
 */
export function headingTargetTitle(state: EditorState): string | null {
  const match = linkAutocompleteMatchAt(state);
  if (match === null) return null;
  const value = linkAutocompleteKey.getState(state);
  if (value === undefined) return null;

  const rows = linkRowsFor(value.titles, value.headings, match.query);
  return rows.mode === 'heading' && rows.title !== null ? normalizeTitle(rows.title) : null;
}

type Meta =
  | { type: 'titles'; titles: readonly string[] }
  | { type: 'headings'; title: string; rows: readonly string[] }
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

/**
 * Stable across keystrokes typing the same link (keyed on `from`, the
 * opening `[[`'s position, not on the query), unlike `widgetKey` above:
 * these are read back by the `view()` lifecycle below to point
 * `aria-activedescendant`/`aria-controls` at a real element, which needs an
 * id that does not change out from under a screen reader mid-selection the
 * way the widget's own rebuild-every-keystroke key deliberately does.
 */
function listboxId(from: number): string {
  return `bear-link-autocomplete-listbox-${from}`;
}

function optionId(from: number, index: number): string {
  return `bear-link-autocomplete-option-${from}-${index}`;
}

function renderPopover(
  labels: NonNullable<LinkAutocompleteOptions['linkAutocompleteLabels']>,
  rows: LinkRows,
  activeIndex: number,
  from: number,
): HTMLElement {
  const matches = rows.rows;
  const heading = rows.mode === 'heading';
  const container = document.createElement('div');
  container.className = 'bear-link-autocomplete';
  container.contentEditable = 'false';

  const popover = document.createElement('div');
  popover.className = 'bear-link-autocomplete-popover';
  popover.contentEditable = 'false';

  const list = document.createElement('ul');
  list.id = listboxId(from);
  list.className = 'bear-link-autocomplete-list';
  list.setAttribute('role', 'listbox');
  // The listbox renames itself, so a screen reader hears WHICH list this is.
  // That is also why the row glyphs stay `aria-hidden`: the distinction is
  // carried here, once, rather than prefixed onto every option.
  list.setAttribute('aria-label', heading ? labels.headingListLabel : labels.listLabel);
  list.tabIndex = -1;

  if (matches.length === 0) {
    list.hidden = true;
    const emptyEl = document.createElement('div');
    emptyEl.className = 'bear-link-autocomplete-empty';
    emptyEl.textContent = heading ? labels.headingEmpty : labels.empty;
    popover.append(list, emptyEl);
  } else {
    matches.forEach((title, index) => {
      const item = document.createElement('li');
      item.id = optionId(from, index);
      item.setAttribute('role', 'option');
      item.setAttribute('data-link-autocomplete-option', String(index));
      item.setAttribute('aria-selected', String(index === activeIndex));
      item.classList.toggle('is-active', index === activeIndex);

      const icon = document.createElement('span');
      icon.className = 'bear-link-autocomplete-icon';
      icon.setAttribute('aria-hidden', 'true');
      // A ProseMirror widget cannot render React, which is why this goes
      // through `renderIconMarkup` rather than through `Icon` — the same
      // constraint `TagAutocomplete.ts` documents at its own icon.
      //
      // `aria-hidden`, so the row's accessible name stays the bare title.
      // The glyph says WHICH popover this is (a document, where a tag row
      // shows a `#`), which is information the screen reader already has
      // from the listbox's own label.
      // A heading glyph in `/` mode, a document otherwise: the two lists look
      // alike by design, so the glyph is what says which one you are reading.
      icon.innerHTML = renderIconMarkup(heading ? Heading : FileText);
      item.append(icon);

      const text = document.createElement('span');
      text.textContent = title;
      item.append(text);

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
function insertLink(
  view: EditorView,
  match: LinkAutocompleteMatch,
  rows: LinkRows,
  index: number,
): void {
  const chosen = rows.rows[index];
  if (chosen === undefined) return;
  // In heading mode BOTH halves come from storage, never from what was typed:
  // the note title from the plugin's own list and the heading from the fetched
  // set, so `[[deploy check/roll]]` completes to `[[Deploy Checklist/Rollback]]`
  // with the casing each one actually has.
  const text = rows.mode === 'heading' && rows.title !== null ? `${rows.title}/${chosen}` : chosen;
  // `closeTo`, not `to`: when the caret sat inside a link the popover had
  // already closed, the replacement must swallow that link's own `]]` rather
  // than leave a second pair stranded after the new one.
  const tr = view.state.tr.insertText(`[[${text}]]`, match.from, match.closeTo);
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
 * Focus itself never leaves the main editable surface while this menu is
 * open — there is no separate input to carry the standard combobox ARIA, the
 * way `CodeLanguageControls`'s filter input does. So the ARIA instead rides
 * the ALREADY-FOCUSED host, `view.dom`, following the editable-combobox
 * pattern (the one GitHub/Twitter `@mention` menus use): `role="combobox"`
 * and `aria-expanded` on the host while the menu is open, `aria-controls`
 * naming the listbox, `aria-activedescendant` naming the active option —
 * all applied and torn down through the plugin's `view()` lifecycle's
 * `update()`/`destroy()`, since `decorations()` itself has no side-effecting
 * hook and no reason to run when the selection alone changes without the
 * document changing. Skipping this wiring would be the same class of
 * silent failure `docs/rulings` already treats as blocking elsewhere in this
 * app — a `NaN` contrast ratio that passes because `NaN < min` is false, PDF
 * text that extracts correctly while every glyph renders as tofu — a
 * keyboard user sees the list open and move with no signal a screen reader
 * can announce at all.
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
            // `linkAutocomplete.test.ts`'s "the trailing-node hazard" suite
            // pins this with a fault injection, not just by reading the tag.
            dispatch(
              tr
                .setMeta(linkAutocompleteKey, { type: 'titles', titles })
                .setMeta(skipTrailingNodeMeta, true),
            );
          }
          return true;
        },

      setLinkAutocompleteHeadings:
        (title: string, rows: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            // `skipTrailingNodeMeta` for the same reason the command above
            // carries it: meta-only, and `TrailingNode.appendTransaction` is
            // not gated on `docChanged`.
            dispatch(
              tr
                .setMeta(linkAutocompleteKey, { type: 'headings', title, rows })
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
          init: () => ({ titles: [], headings: null, activeIndex: 0, dismissedFrom: null }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(linkAutocompleteKey) as Meta | undefined;

            if (meta?.type === 'titles') return { ...value, titles: meta.titles };

            if (meta?.type === 'headings') {
              return { ...value, headings: { title: meta.title, rows: meta.rows } };
            }

            if (meta?.type === 'dismiss') return { ...value, dismissedFrom: meta.from };

            if (meta?.type === 'move') {
              const match = linkAutocompleteMatchAt(newState);
              const matches =
                match === null ? [] : linkRowsFor(value.titles, value.headings, match.query).rows;
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

            const rows = linkRowsFor(pluginState.titles, pluginState.headings, match.query);
            const activeIndex = clampedActiveIndex(pluginState.activeIndex, rows.rows.length);

            return DecorationSet.create(state.doc, [
              Decoration.widget(
                match.to,
                () => renderPopover(labels, rows, activeIndex, match.from),
                {
                  side: 1,
                  ignoreSelection: true,
                  key: widgetKey(match, activeIndex),
                },
              ),
            ]);
          },

          handleKeyDown(view, event) {
            const match = linkAutocompleteMatchAt(view.state);
            if (match === null) return false;

            const pluginState = linkAutocompleteKey.getState(view.state);
            if (pluginState === undefined) return false;
            if (pluginState.dismissedFrom === match.from) return false;

            const rows = linkRowsFor(pluginState.titles, pluginState.headings, match.query);
            const matches = rows.rows;

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
                if (matches[activeIndex] === undefined) return false;
                insertLink(view, match, rows, activeIndex);
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

                const rows = linkRowsFor(pluginState.titles, pluginState.headings, match.query);
                insertLink(
                  view,
                  match,
                  rows,
                  Number(option.getAttribute('data-link-autocomplete-option')),
                );
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

        // Exists for exactly one thing: mirroring the open/active state onto
        // `view.dom` as `role`/`aria-expanded`/`aria-controls`/
        // `aria-activedescendant`, the standard editable-combobox pattern,
        // applied to the ALREADY-FOCUSED host rather than to a dedicated
        // input this control does not have — see the module docblock.
        // `originalRole` is captured once so closing restores whatever the
        // host carried before this plugin ever touched it (`"textbox"` in
        // `RichEditor`, nothing in a bare test harness) rather than assuming
        // a fixed baseline.
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
            const match = linkAutocompleteMatchAt(view.state);
            const pluginState = linkAutocompleteKey.getState(view.state);
            if (
              match === null ||
              pluginState === undefined ||
              pluginState.dismissedFrom === match.from
            ) {
              clear(view);
              return;
            }

            const matches = linkRowsFor(pluginState.titles, pluginState.headings, match.query).rows;
            const activeIndex = clampedActiveIndex(pluginState.activeIndex, matches.length);

            view.dom.setAttribute('role', 'combobox');
            view.dom.setAttribute('aria-expanded', 'true');
            view.dom.setAttribute('aria-controls', listboxId(match.from));
            if (activeIndex >= 0) {
              view.dom.setAttribute('aria-activedescendant', optionId(match.from, activeIndex));
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
      /**
       * Hands the popover one note's headings for its `/` mode.
       *
       * Carries the NOTE TITLE it fetched for, not just the rows: the fetch
       * is asynchronous, and a result landing after the reader has backspaced
       * to a different note must be ignored rather than listed under the
       * wrong one.
       */
      setLinkAutocompleteHeadings: (title: string, rows: string[]) => ReturnType;
    };
  }
}
