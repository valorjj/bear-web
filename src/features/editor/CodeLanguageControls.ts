import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { CODE_LANGUAGES, languageLabel, resolveLanguage } from './codeLanguages';

export interface CodeLanguageControlsOptions {
  /**
   * The control's own chrome, plus `none` for the "no language" choice.
   * `null` when nobody supplied them — the state of the schema-only
   * `editorExtensions` constant — and in that state NO PLUGIN is registered
   * at all.
   *
   * Absent rather than unlabelled, deliberately, exactly like
   * `TableControls.labels`: no user-facing string may be hardcoded, and a
   * control with blank text would be worse than no control. The twelve
   * language display names are NOT here — they are `label` fields on
   * `CODE_LANGUAGES`, proper nouns identical in every locale.
   */
  codeLabels: { trigger: string; none: string; filter: string; empty: string } | null;
}

export const codeLanguageControlsKey = new PluginKey('codeLanguageControls');

/**
 * The document position of the code block the selection is inside, or
 * `null`.
 *
 * Walks OUTWARD from the cursor exactly as `tablePosAt` does, so a code
 * block nested in a blockquote or list item still resolves to itself.
 */
export function codeBlockPosAt(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'codeBlock') return $from.before(depth);
  }
  return null;
}

type LanguageChoice = { id: string | null; label: string };

/** `''` stands for the "plain text"/no-language choice throughout this
 * module — option ids, `aria-activedescendant` targets and DOM
 * `data-code-language-option` values all use it instead of `null`, because
 * it can go straight into an element id with no encoding step. */
function keyOf(choice: LanguageChoice): string {
  return choice.id ?? '';
}

function choices(): readonly LanguageChoice[] {
  return [{ id: null, label: '' }, ...CODE_LANGUAGES.map((l) => ({ id: l.id, label: l.label }))];
}

/**
 * Whether picking `choice` for a code block whose fence currently reads
 * `fence` would be a document no-op.
 *
 * `ts` must stay `ts` when the user re-picks "TypeScript" from the list —
 * normalizing an alias to its canonical id would silently rewrite the user's
 * file on the next autosave, exactly what `docs/rulings/notes-lifecycle.md`
 * exists to prevent. An UNKNOWN fence (`rust`) is never treated as already
 * "plain text": picking "Plain text" over it is a real edit that clears it.
 */
function isNoOp(choice: LanguageChoice, fence: string | null): boolean {
  if (choice.id === null) return !fence || fence.trim() === '';
  return resolveLanguage(fence)?.id === choice.id;
}

/**
 * The key of the choice that is currently IN EFFECT for `fence`, for
 * `aria-selected` purposes — distinct from `isNoOp`, which asks about a
 * hypothetical pick, and distinct from the keyboard-navigation "active"
 * choice below, which is about where the cursor sits in the list, not what
 * the document holds.
 *
 * Three cases: a blank fence selects "plain text" (`''`); a fence naming a
 * known language (by id or alias) selects that language's key; an UNKNOWN
 * fence (`rust`) selects nothing at all — it is neither "plain text" nor any
 * language this editor knows, and marking "Plain text" as selected over it
 * would misreport what the document holds.
 */
function selectedKey(fence: string | null): string | undefined {
  if (!fence || fence.trim() === '') return '';
  return resolveLanguage(fence)?.id;
}

function optionId(pos: number, key: string): string {
  return `bear-code-language-option-${pos}-${key === '' ? 'none' : key}`;
}

/**
 * Rebuilds the option list against the current fence and filter text, and
 * returns the key of the option that ends up ACTIVE (keyboard-highlighted),
 * or `null` if the filter matched nothing.
 *
 * `preferredKey` wins if it survives the filter; otherwise the first match
 * wins. Passing `undefined` (opening the popover) prefers the fence's own
 * `selectedKey`; passing an explicit key (arrow-key movement) prefers that
 * exact key; the filter's own `input` handler passes `undefined` too, but
 * WITHOUT `selectedKey` winning ties, because requirement 5 wants the first
 * match after a fresh keystroke, not a resurrected stale selection — see the
 * `input` handler below, which never carries the fence's selected key
 * forward on its own.
 */
function renderOptions(
  list: HTMLUListElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
  fence: string | null,
  filterText: string,
  pos: number,
  preferredKey?: string,
): string | null {
  list.replaceChildren();

  const query = filterText.trim().toLowerCase();
  const selected = selectedKey(fence);
  const matches = choices().filter((choice) => {
    const label = choice.id === null ? labels.none : choice.label;
    return label.toLowerCase().includes(query);
  });

  if (matches.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'bear-code-language-empty';
    empty.textContent = labels.empty;
    list.appendChild(empty);
    list.removeAttribute('aria-activedescendant');
    return null;
  }

  const keys = matches.map(keyOf);
  const activeKey =
    preferredKey !== undefined && keys.includes(preferredKey) ? preferredKey : keys[0]!;

  for (const choice of matches) {
    const key = keyOf(choice);
    const label = choice.id === null ? labels.none : choice.label;
    const item = document.createElement('li');
    item.id = optionId(pos, key);
    item.setAttribute('role', 'option');
    item.setAttribute('data-code-language-option', key);
    item.setAttribute('aria-selected', String(key === selected));
    item.classList.toggle('is-active', key === activeKey);
    item.textContent = label;
    list.appendChild(item);
  }

  list.setAttribute('aria-activedescendant', optionId(pos, activeKey));
  return activeKey;
}

function controlElement(
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
  fence: string | null,
  pos: number,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'bear-code-language';
  container.contentEditable = 'false';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'bear-code-language-trigger';
  trigger.contentEditable = 'false';
  trigger.setAttribute('data-code-language', 'trigger');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const currentLabel = languageLabel(fence) ?? labels.none;
  trigger.textContent = currentLabel;
  // The name must convey what the control DOES, not merely the language in
  // effect: a trigger that reads only "TypeScript" tells a screen-reader
  // user nothing about what activating it will offer.
  trigger.setAttribute('aria-label', `${labels.trigger}: ${currentLabel}`);

  const popover = document.createElement('div');
  popover.className = 'bear-code-language-popover';
  popover.contentEditable = 'false';
  popover.hidden = true;

  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.className = 'bear-code-language-filter';
  filterInput.contentEditable = 'false';
  filterInput.setAttribute('data-code-language', 'filter');
  filterInput.setAttribute('aria-label', labels.filter);
  filterInput.placeholder = labels.filter;

  const list = document.createElement('ul');
  list.setAttribute('role', 'listbox');
  list.setAttribute('data-code-language', 'list');
  list.className = 'bear-code-language-list';
  // The listbox itself owns focus and keyboard input; its options are never
  // separately tabbable — that would fight the `aria-activedescendant`
  // pattern by giving assistive tech two contradictory ideas of where focus
  // is. See `docs/rulings/accessibility.md`.
  list.tabIndex = -1;

  popover.append(filterInput, list);
  container.append(trigger, popover);

  renderOptions(list, labels, fence, '', pos);

  return container;
}

/**
 * A trigger button, floating before the code block the caret is in, that
 * opens a filterable, keyboard-navigable listbox of the twelve known
 * languages plus "plain text".
 *
 * Built exactly like `TableControls`: a `Decoration.widget` with `side: -1`
 * and a stable `key`, so it lives inside the scrolling content and is
 * reused rather than rebuilt across the many transactions that move the
 * caret within the same code block; a single `Plugin` with no `state` field
 * that decorates the ACTIVE block and delegates every interaction through
 * `handleDOMEvents`, matched by `closest()` against `data-code-language*`
 * attributes, rather than per-node listeners. It is an `Extension`, not a
 * `Node`: it registers nothing in the schema and mutates no document by
 * merely existing, so every Markdown round-trip test is blind to whether it
 * runs at all — `codeLanguageControls.test.ts` asserts on the rendered DOM
 * instead, the way `tableControls.test.ts` does.
 *
 * The `view()` lifecycle below exists for exactly one thing: closing the
 * popover on a mousedown OUTSIDE it, including outside the editor entirely
 * (a click on the sidebar does not reach `handleDOMEvents`, which only sees
 * events inside `view.dom`). It is added once per editor view and removed on
 * `destroy`, the way a React component would clean up a `document` listener
 * in `ScopeMenu`'s outside-click handling — this plugin has no component
 * lifecycle to hang it from, so `view()` is ProseMirror's equivalent.
 */
export const CodeLanguageControls = Extension.create<CodeLanguageControlsOptions>({
  name: 'codeLanguageControls',

  addOptions() {
    return { codeLabels: null };
  },

  addProseMirrorPlugins() {
    const { codeLabels } = this.options;
    if (codeLabels === null) return [];
    const labels = codeLabels;

    return [
      new Plugin({
        key: codeLanguageControlsKey,

        props: {
          decorations(state) {
            const pos = codeBlockPosAt(state);
            if (pos === null) return DecorationSet.empty;

            const node = state.doc.nodeAt(pos);
            const fence = (node?.attrs.language as string | null | undefined) ?? null;

            return DecorationSet.create(state.doc, [
              Decoration.widget(pos, () => controlElement(labels, fence, pos), {
                side: -1,
                key: `code-language-${pos}`,
                ignoreSelection: true,
              }),
            ]);
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;

              const trigger = target?.closest<HTMLElement>('[data-code-language="trigger"]');
              if (trigger) {
                if (event.button !== 0) return false;
                event.preventDefault();
                toggle(view, trigger, labels);
                return true;
              }

              const option = target?.closest<HTMLElement>('[data-code-language-option]');
              if (option) {
                if (event.button !== 0) return false;
                event.preventDefault();
                choose(view, option, labels);
                return true;
              }

              // A click anywhere else inside the widget (the popover's own
              // background, or the filter input) must not fall through to
              // the editor and move the caret, but it is not an activation
              // either.
              if (target?.closest('.bear-code-language')) {
                event.preventDefault();
                return true;
              }

              return false;
            },

            input(view, event) {
              const target = event.target as HTMLElement | null;
              const filterInput = target?.closest<HTMLInputElement>(
                '[data-code-language="filter"]',
              );
              if (!filterInput) return false;

              const container = filterInput.closest<HTMLElement>('.bear-code-language');
              const list = container?.querySelector<HTMLUListElement>(
                '[data-code-language="list"]',
              );
              if (!container || !list) return false;

              const pos = codeBlockPosAt(view.state);
              if (pos === null) return false;
              const node = view.state.doc.nodeAt(pos);
              const fence = (node?.attrs.language as string | null | undefined) ?? null;

              // No `preferredKey`: requirement 5 is that a fresh keystroke
              // lands the active option on the first match, never a stale
              // index left over from before the filter narrowed the list.
              renderOptions(list, labels, fence, filterInput.value, pos);
              return true;
            },

            keydown(view, event) {
              const target = event.target as HTMLElement | null;
              const container = target?.closest<HTMLElement>('.bear-code-language');
              if (!container) return false;

              // The trigger is a plain `<button>`: a keyboard activation
              // (Enter, and Space on keyup) fires as a native `click`, which
              // this plugin does not otherwise listen for — only `mousedown`,
              // so a real mouse click is not double-toggled by both events.
              // Handling Enter/Space HERE, and calling `preventDefault()`, is
              // what suppresses that synthetic click and makes this the only
              // place the keyboard path opens or closes the popover.
              const triggerEl = target?.closest<HTMLElement>('[data-code-language="trigger"]');
              if (triggerEl && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                toggle(view, triggerEl, labels);
                return true;
              }

              const list = container.querySelector<HTMLUListElement>('[data-code-language="list"]');
              if (!list) return false;

              const isFilterInput = target?.closest('[data-code-language="filter"]') != null;

              switch (event.key) {
                case 'Escape':
                  event.preventDefault();
                  close(container);
                  return true;

                case 'ArrowDown':
                  event.preventDefault();
                  moveActive(list, 'next');
                  return true;

                case 'ArrowUp':
                  event.preventDefault();
                  moveActive(list, 'prev');
                  return true;

                case 'Home':
                  event.preventDefault();
                  moveActive(list, 'first');
                  return true;

                case 'End':
                  event.preventDefault();
                  moveActive(list, 'last');
                  return true;

                case 'Enter':
                  event.preventDefault();
                  chooseActive(view, list, labels);
                  return true;

                case ' ':
                  // Space must stay a literal character while the filter
                  // input has focus — only the list's own Space activates
                  // the highlighted option, matching how a native listbox
                  // treats Space as "select", never "type".
                  if (isFilterInput) return false;
                  event.preventDefault();
                  chooseActive(view, list, labels);
                  return true;

                default:
                  return false;
              }
            },
          },
        },

        view(editorView) {
          const onDocumentMouseDown = (event: MouseEvent): void => {
            const openPopover = editorView.dom.querySelector<HTMLElement>(
              '.bear-code-language-popover:not([hidden])',
            );
            if (!openPopover) return;

            const target = event.target as HTMLElement | null;
            if (target?.closest('.bear-code-language')) return;

            const container = openPopover.closest<HTMLElement>('.bear-code-language');
            // No focus return here: the user clicked something else on
            // purpose (the sidebar, another note), and forcing focus back to
            // the trigger would fight whatever they actually clicked.
            if (container) close(container, { returnFocus: false });
          };

          document.addEventListener('mousedown', onDocumentMouseDown, true);

          return {
            destroy() {
              document.removeEventListener('mousedown', onDocumentMouseDown, true);
            },
          };
        },
      }),
    ];
  },
});

/** The rendered `[role="option"]` elements, in DOM (visual) order. */
function optionElements(list: HTMLUListElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[role="option"]')];
}

/**
 * Moves the keyboard-active option, wrapping at both ends, and updates
 * `aria-activedescendant` plus the `.is-active` visual highlight to match.
 * Does not touch `aria-selected` — that tracks the document's actual
 * language, not where keyboard navigation happens to be standing.
 */
function moveActive(list: HTMLUListElement, direction: 'next' | 'prev' | 'first' | 'last'): void {
  const options = optionElements(list);
  if (options.length === 0) return;

  const currentId = list.getAttribute('aria-activedescendant');
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.id === currentId),
  );

  let nextIndex: number;
  switch (direction) {
    case 'next':
      nextIndex = (currentIndex + 1) % options.length;
      break;
    case 'prev':
      nextIndex = (currentIndex - 1 + options.length) % options.length;
      break;
    case 'first':
      nextIndex = 0;
      break;
    case 'last':
      nextIndex = options.length - 1;
      break;
  }

  for (const option of options) option.classList.remove('is-active');
  const next = options[nextIndex]!;
  next.classList.add('is-active');
  list.setAttribute('aria-activedescendant', next.id);
}

/** Opens or closes the popover attached to `trigger`, focusing the list on
 * open — per `docs/rulings/accessibility.md`, the listbox itself owns
 * keyboard focus rather than any of its options — and re-rendering its
 * options against the block's current fence, so a stale list from a
 * previous open never lingers. */
function toggle(
  view: EditorView,
  trigger: HTMLElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
): void {
  const container = trigger.closest<HTMLElement>('.bear-code-language');
  const popover = container?.querySelector<HTMLElement>('.bear-code-language-popover');
  if (!container || !popover) return;

  if (popover.hidden) {
    const list = container.querySelector<HTMLUListElement>('[data-code-language="list"]');
    const filterInput = container.querySelector<HTMLInputElement>('[data-code-language="filter"]');
    const pos = codeBlockPosAt(view.state);
    const node = pos === null ? null : view.state.doc.nodeAt(pos);
    const fence = (node?.attrs.language as string | null | undefined) ?? null;
    if (filterInput) filterInput.value = '';

    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');

    if (list && pos !== null) {
      // The current language wins the initial highlight, per requirement 4
      // — a keyboard user opening the picker on a `ts` block should not have
      // to arrow past eleven other languages to find where they started.
      renderOptions(list, labels, fence, '', pos, selectedKey(fence));
      list.focus();
    }
  } else {
    close(container);
  }
}

/** Hides the popover and, by default, returns focus to its trigger — the
 * contract Escape and a completed selection share. An outside click passes
 * `returnFocus: false`, because forcing focus back would fight wherever the
 * user actually clicked. */
function close(container: HTMLElement, options: { returnFocus?: boolean } = {}): void {
  const { returnFocus = true } = options;
  const popover = container.querySelector<HTMLElement>('.bear-code-language-popover');
  const trigger = container.querySelector<HTMLElement>('[data-code-language="trigger"]');
  if (popover) popover.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (returnFocus) trigger?.focus();
}

/**
 * Applies the clicked or keyboard-activated option's language to the code
 * block the popover belongs to, unless doing so would be a no-op (see
 * `isNoOp`), then closes the popover and restores focus to the editor.
 *
 * Also refreshes the TRIGGER's own label directly, rather than trusting the
 * next `decorations()` pass to do it: `Decoration.widget` is matched and
 * reused by `(pos, side, key)` across transactions, exactly like
 * `TableControls`' bar — its own comment calls this out as the reason the
 * widget survives edits inside the same table without rebuilding. That
 * reuse means a fresh `decorations()` call with an UPDATED fence still
 * returns the same cached DOM node rather than invoking `controlElement`
 * again, so the trigger would otherwise keep showing the language it had
 * when the widget was first built until the caret leaves the block and
 * returns. Measured via Playwright, not reasoned out in advance — a jsdom
 * unit test cannot see this, because nothing there re-decorates on a timer
 * the way a real transaction dispatch does.
 */
function choose(
  view: EditorView,
  option: HTMLElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
): void {
  const container = option.closest<HTMLElement>('.bear-code-language');
  if (!container) return;

  const pos = codeBlockPosAt(view.state);
  if (pos === null) {
    close(container);
    return;
  }
  const node = view.state.doc.nodeAt(pos);
  if (!node) {
    close(container);
    return;
  }
  const fence = (node.attrs.language as string | null | undefined) ?? null;
  const rawId = option.getAttribute('data-code-language-option') ?? '';
  const choice: LanguageChoice = { id: rawId === '' ? null : rawId, label: '' };

  if (!isNoOp(choice, fence)) {
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      language: choice.id,
    });
    view.dispatch(tr);

    const triggerEl = container.querySelector<HTMLElement>('[data-code-language="trigger"]');
    if (triggerEl) {
      const newLabel = languageLabel(choice.id) ?? labels.none;
      triggerEl.textContent = newLabel;
      triggerEl.setAttribute('aria-label', `${labels.trigger}: ${newLabel}`);
    }
  }

  close(container);
  view.focus();
}

/** `Enter`/`Space` on the list: resolves the option `aria-activedescendant`
 * names and applies it exactly the way a click on that option would. */
function chooseActive(
  view: EditorView,
  list: HTMLUListElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
): void {
  const activeId = list.getAttribute('aria-activedescendant');
  if (!activeId) return;
  const option = list.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`);
  if (option) choose(view, option, labels);
}
