import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import {
  CODE_LANGUAGES,
  DIAGRAM_LANGUAGE_ID,
  languageLabel,
  resolveLanguage,
} from './codeLanguages';

export interface CodeLanguageControlsOptions {
  /**
   * The control's own chrome, plus `none` for the "no language" choice and
   * `diagram` for L5's Mermaid row.
   * `null` when nobody supplied them — the state of the schema-only
   * `editorExtensions` constant — and in that state NO PLUGIN is registered
   * at all.
   *
   * Absent rather than unlabelled, deliberately, exactly like
   * `TableHandles.labels`: no user-facing string may be hardcoded, and a
   * control with blank text would be worse than no control. The twelve
   * language display names are NOT here — they are `label` fields on
   * `CODE_LANGUAGES`, proper nouns identical in every locale.
   */
  codeLabels: {
    trigger: string;
    none: string;
    filter: string;
    empty: string;
    /**
     * The Mermaid row's name. Translated, unlike the twelve `label` fields
     * on `CODE_LANGUAGES` — "Diagram" is a common noun, not a proper one —
     * which is why it rides here beside `none` rather than in that array.
     */
    diagram: string;
  } | null;
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

/**
 * The choices offered for `fence`: "plain text", the twelve known
 * languages, and — ONLY when `fence` names a language this editor does not
 * know — an extra ECHO row at the front, whose id and label are the fence
 * text verbatim.
 *
 * The echo row exists to close the destructive path this control would
 * otherwise have: without it, opening the picker on a `rust` block defaults
 * the active option to "Plain text" (index 0), and a keyboard user who opens
 * and immediately presses Enter — a resting-position gesture, not a
 * deliberate choice — silently clears a fence the user typed on purpose.
 * With the echo row, opening on `rust` defaults the active option to a row
 * that reads "rust", and re-choosing it is a no-op (see `isNoOp`), never an
 * edit.
 */
function choices(fence: string | null): readonly LanguageChoice[] {
  const base: LanguageChoice[] = [
    { id: null, label: '' },
    ...CODE_LANGUAGES.map((l) => ({ id: l.id, label: l.label })),
    // Last, and on its own: this fence is RENDERED rather than highlighted,
    // so it is not one of the twelve and its label comes from `codeLabels`
    // (see `labelOf`) rather than from `CODE_LANGUAGES`.
    { id: DIAGRAM_LANGUAGE_ID, label: '' },
  ];
  const trimmed = fence?.trim() ?? '';
  // `mermaid` resolves to no highlight grammar, so without this exclusion it
  // would ALSO get an echo row — two rows carrying the same id, and therefore
  // the same element id and the same `aria-selected`.
  if (trimmed !== '' && trimmed !== DIAGRAM_LANGUAGE_ID && resolveLanguage(fence) === null) {
    return [{ id: trimmed, label: trimmed }, ...base];
  }
  return base;
}

/**
 * A choice's display name.
 *
 * Two ids take their name from `codeLabels` rather than from the choice
 * itself: `null` ("plain text") and `mermaid` ("Diagram"). Both are common
 * nouns and must be translated; every other row is a proper noun carried as
 * data on `CODE_LANGUAGES`.
 */
function labelOf(
  choice: LanguageChoice,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
): string {
  if (choice.id === null) return labels.none;
  if (choice.id === DIAGRAM_LANGUAGE_ID) return labels.diagram;
  return choice.label;
}

/**
 * What the TRIGGER reads for a fence, which is `languageLabel` plus the same
 * two translated exceptions `labelOf` makes.
 */
function triggerLabel(
  fence: string | null,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
): string {
  if (fence !== null && fence.trim().toLowerCase() === DIAGRAM_LANGUAGE_ID) return labels.diagram;
  return languageLabel(fence) ?? labels.none;
}

/**
 * Whether picking `choice` for a code block whose fence currently reads
 * `fence` would be a document no-op.
 *
 * `ts` must stay `ts` when the user re-picks "TypeScript" from the list —
 * normalizing an alias to its canonical id would silently rewrite the user's
 * file on the next autosave, exactly what `docs/rulings/notes-lifecycle.md`
 * exists to prevent. An UNKNOWN fence (`rust`) is never treated as already
 * "plain text": picking "Plain text" over it is a real edit that clears it —
 * but re-picking the ECHO row that reads "rust" (see `choices`) IS a no-op,
 * because it is the same text the fence already holds.
 */
function isNoOp(choice: LanguageChoice, fence: string | null): boolean {
  if (choice.id === null) return !fence || fence.trim() === '';
  const resolved = resolveLanguage(fence);
  if (resolved) return resolved.id === choice.id;
  return fence !== null && fence.trim() === choice.id;
}

/**
 * The key of the choice that is currently IN EFFECT for `fence` — used both
 * for `aria-selected` and as the default active row when the popover opens.
 *
 * Three cases: a blank fence selects "plain text" (`''`); a fence naming a
 * known language (by id or alias) selects that language's key; an UNKNOWN
 * fence (`rust`) selects the ECHO row's key (the trimmed fence text itself,
 * always present in `choices(fence)` for exactly this case) — never "plain
 * text", which would misreport what the document holds and, as the default
 * active row, would put one keystroke between the user and erasing it.
 */
function selectedKey(fence: string | null): string {
  if (!fence || fence.trim() === '') return '';
  const resolved = resolveLanguage(fence);
  return resolved ? resolved.id : fence.trim();
}

/** Sanitized for use as an HTML `id`: language ids and fence text are
 * normally plain identifiers, but a fence is user input, and an id
 * attribute must not contain whitespace. */
function slug(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned === '' ? 'none' : cleaned;
}

function optionId(pos: number, key: string): string {
  return `bear-code-language-option-${pos}-${slug(key)}`;
}

function listboxId(pos: number): string {
  return `bear-code-language-listbox-${pos}`;
}

/** The widget's own elements, looked up fresh each time rather than
 * threaded through every function individually — the DOM is the only state
 * this plugin keeps, so reading it back is simpler than a growing parameter
 * list, and it can never itself go stale the way a captured reference to a
 * REPLACED node would (there are no replacements here; `renderOptions`
 * mutates the same list in place). */
function widgetParts(container: HTMLElement): {
  trigger: HTMLElement | null;
  popover: HTMLElement | null;
  filterInput: HTMLInputElement | null;
  list: HTMLUListElement | null;
  emptyEl: HTMLElement | null;
} {
  return {
    trigger: container.querySelector<HTMLElement>('[data-code-language="trigger"]'),
    popover: container.querySelector<HTMLElement>('.bear-code-language-popover'),
    filterInput: container.querySelector<HTMLInputElement>('[data-code-language="filter"]'),
    list: container.querySelector<HTMLUListElement>('[data-code-language="list"]'),
    emptyEl: container.querySelector<HTMLElement>('.bear-code-language-empty'),
  };
}

/** The rendered `[role="option"]` elements, in DOM (visual) order. */
function optionElements(list: HTMLUListElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[role="option"]')];
}

/**
 * Rebuilds the option list against the current fence and filter text, and
 * returns the key of the option that ends up ACTIVE (keyboard-highlighted),
 * or `null` if the filter matched nothing.
 *
 * The empty state is rendered as a SIBLING of the `<ul>`, never inside it:
 * `role="listbox"` permits only `option`/`group` children, and an `<li>`
 * with neither role sitting inside one is an ARIA pattern violation no unit
 * test enforces.
 *
 * `preferredKey` wins if it survives the filter; otherwise the first match
 * wins. Passing `undefined` (a fresh filter keystroke) deliberately does
 * NOT fall back to the fence's own `selectedKey` — requirement 5 is that a
 * fresh keystroke lands on the first match, never a stale or resurrected
 * selection. Opening the popover passes `selectedKey(fence)` explicitly.
 */
function renderOptions(
  container: HTMLElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
  fence: string | null,
  filterText: string,
  pos: number,
  preferredKey?: string,
): string | null {
  const { list, emptyEl, filterInput } = widgetParts(container);
  if (!list) return null;

  list.replaceChildren();

  const query = filterText.trim().toLowerCase();
  const selected = selectedKey(fence);
  const matches = choices(fence).filter((choice) => {
    return labelOf(choice, labels).toLowerCase().includes(query);
  });

  if (matches.length === 0) {
    list.hidden = true;
    list.removeAttribute('aria-activedescendant');
    filterInput?.removeAttribute('aria-activedescendant');
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = labels.empty;
    }
    return null;
  }

  if (emptyEl) emptyEl.hidden = true;
  list.hidden = false;

  const keys = matches.map(keyOf);
  const activeKey =
    preferredKey !== undefined && keys.includes(preferredKey) ? preferredKey : keys[0]!;

  for (const choice of matches) {
    const key = keyOf(choice);
    const label = labelOf(choice, labels);
    const item = document.createElement('li');
    item.id = optionId(pos, key);
    item.setAttribute('role', 'option');
    item.setAttribute('data-code-language-option', key);
    item.setAttribute('aria-selected', String(key === selected));
    item.classList.toggle('is-active', key === activeKey);
    item.textContent = label;
    list.appendChild(item);
  }

  const activeId = optionId(pos, activeKey);
  list.setAttribute('aria-activedescendant', activeId);
  // Mirrored onto the filter input too: it is what actually holds DOM focus
  // (see `toggle`), and `aria-activedescendant` is meaningful to assistive
  // tech on whichever element currently has focus. `aria-controls` below
  // ties the two together the way a combobox ties an editable field to the
  // listbox it filters, per `docs/rulings/accessibility.md`.
  filterInput?.setAttribute('aria-activedescendant', activeId);

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

  const currentLabel = triggerLabel(fence, labels);
  trigger.textContent = currentLabel;
  // The name must convey what the control DOES, not merely the language in
  // effect: a trigger that reads only "TypeScript" tells a screen-reader
  // user nothing about what activating it will offer.
  trigger.setAttribute('aria-label', `${labels.trigger}: ${currentLabel}`);

  const popover = document.createElement('div');
  popover.className = 'bear-code-language-popover';
  popover.contentEditable = 'false';
  popover.hidden = true;

  const list = document.createElement('ul');
  list.id = listboxId(pos);
  list.setAttribute('role', 'listbox');
  list.setAttribute('data-code-language', 'list');
  list.className = 'bear-code-language-list';
  // The listbox is a popup controlled by the filter input below, per the
  // combobox pattern `docs/rulings/accessibility.md` calls for — it is
  // never itself a separate Tab stop.
  list.tabIndex = -1;

  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.className = 'bear-code-language-filter';
  filterInput.contentEditable = 'false';
  filterInput.setAttribute('data-code-language', 'filter');
  filterInput.setAttribute('aria-label', labels.filter);
  filterInput.setAttribute('aria-controls', list.id);
  filterInput.placeholder = labels.filter;

  // A SIBLING of the list, not a child of it — see `renderOptions`'s
  // docblock for why: `role="listbox"` permits only `option`/`group`
  // children.
  const emptyEl = document.createElement('div');
  emptyEl.className = 'bear-code-language-empty';
  emptyEl.hidden = true;

  popover.append(filterInput, list, emptyEl);
  container.append(trigger, popover);

  renderOptions(container, labels, fence, '', pos, selectedKey(fence));

  return container;
}

/**
 * A trigger button, floating before the code block the caret is in, that
 * opens a filterable, keyboard-navigable listbox of the twelve known
 * languages plus "plain text".
 *
 * Built exactly like `TableHandles`: a `Decoration.widget` with `side: -1`
 * and a stable `key`, so it lives inside the scrolling content and is
 * reused rather than rebuilt across the many transactions that move the
 * caret within the same code block; a single `Plugin` with no `state` field
 * that decorates the ACTIVE block and delegates every interaction through
 * `handleDOMEvents`, matched by `closest()` against `data-code-language*`
 * attributes, rather than per-node listeners. It is an `Extension`, not a
 * `Node`: it registers nothing in the schema and mutates no document by
 * merely existing, so every Markdown round-trip test is blind to whether it
 * runs at all — `codeLanguageControls.test.ts` asserts on the rendered DOM
 * instead, the way `tableHandles.test.ts` does.
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
              if (!container) return false;

              const pos = codeBlockPosAt(view.state);
              if (pos === null) return false;
              const node = view.state.doc.nodeAt(pos);
              const fence = (node?.attrs.language as string | null | undefined) ?? null;

              // No `preferredKey`: requirement 5 is that a fresh keystroke
              // lands the active option on the first match, never a stale
              // index left over from before the filter narrowed the list.
              renderOptions(container, labels, fence, filterInput.value, pos);
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
              // Handling the open keys HERE, and calling `preventDefault()`,
              // is what suppresses that synthetic click and makes this the
              // only place the keyboard path opens the popover. ArrowDown/Up
              // and Home/End also open it — standard listbox-button
              // behaviour — since the trigger only ever holds focus while
              // the popover is closed (opening moves focus to the filter
              // input), there is no "already open" case to disambiguate.
              const triggerEl = target?.closest<HTMLElement>('[data-code-language="trigger"]');
              if (
                triggerEl &&
                ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
              ) {
                event.preventDefault();
                toggle(view, triggerEl, labels);
                return true;
              }

              const { list } = widgetParts(container);
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
                  // input has focus — that is the DEFAULT once the popover
                  // is open, per `toggle` below — and only activates the
                  // highlighted option from elsewhere in the widget (there
                  // is no other focusable elsewhere today, but the guard
                  // documents the intent rather than relying on that).
                  if (isFilterInput) return false;
                  event.preventDefault();
                  chooseActive(view, list, labels);
                  return true;

                default:
                  return false;
              }
            },

            // Tab (or a click) moving focus OUT of the widget entirely must
            // close the popover — without this, Tabbing to the bottom
            // toolbar left a stale open listbox in the accessibility tree,
            // with `aria-expanded="true"` describing a control nobody could
            // see was still claiming to be open.
            focusout(_view, event) {
              const target = event.target as HTMLElement | null;
              const container = target?.closest<HTMLElement>('.bear-code-language');
              if (!container) return false;

              const { popover } = widgetParts(container);
              if (!popover || popover.hidden) return false;

              const related = (event as FocusEvent).relatedTarget as HTMLElement | null;
              // Focus moving to another element WITHIN the widget (input <->
              // list <-> an option) is not a dismissal.
              if (related && container.contains(related)) return false;

              close(container, { returnFocus: false });
              return false;
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

/**
 * Moves the keyboard-active option, wrapping at both ends, and updates
 * `aria-activedescendant` (on the list AND the filter input — see
 * `renderOptions`) plus the `.is-active` visual highlight to match. Does not
 * touch `aria-selected` — that tracks the document's actual language, not
 * where keyboard navigation happens to be standing.
 *
 * Scrolls the new active option into view every time: `aria-activedescendant`
 * changes what assistive tech announces, but does nothing to the viewport —
 * past the 8th of thirteen rows the active option went fully outside the
 * list's own `overflow-y: auto` box with no visual indication anywhere,
 * measured in a real browser (`list.scrollTop` stayed `0` after `End`, jsdom
 * cannot see this at all).
 */
function moveActive(list: HTMLUListElement, direction: 'next' | 'prev' | 'first' | 'last'): void {
  const options = optionElements(list);
  if (options.length === 0) return;

  const filterInput = list
    .closest<HTMLElement>('.bear-code-language')
    ?.querySelector<HTMLInputElement>('[data-code-language="filter"]');

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
  filterInput?.setAttribute('aria-activedescendant', next.id);
  next.scrollIntoView({ block: 'nearest' });
}

/**
 * Opens or closes the popover attached to `trigger`.
 *
 * Opening focuses the FILTER INPUT, not the list: a keyboard user has to be
 * able to type a language name the moment the popover appears, and DOM
 * order alone (input before list) only made that reachable via Shift+Tab.
 * Arrow keys, Home/End, Enter and Space are all handled by delegated
 * `keydown` regardless of which of the two currently holds focus, so this
 * matches the standard combobox-with-listbox-popup pattern: an editable
 * field that filters, with the popup listbox as its passive companion.
 *
 * Also re-renders the options against the block's current fence, so a
 * stale list from a previous open never lingers, and seeds the active row
 * on the block's CURRENT language — the echo row when the fence is unknown,
 * never "plain text" by default (see `choices`/`selectedKey`).
 */
function toggle(
  view: EditorView,
  trigger: HTMLElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
): void {
  const container = trigger.closest<HTMLElement>('.bear-code-language');
  if (!container) return;
  const { popover, filterInput } = widgetParts(container);
  if (!popover) return;

  if (popover.hidden) {
    const pos = codeBlockPosAt(view.state);
    const node = pos === null ? null : view.state.doc.nodeAt(pos);
    const fence = (node?.attrs.language as string | null | undefined) ?? null;
    if (filterInput) filterInput.value = '';

    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');

    if (pos !== null) {
      renderOptions(container, labels, fence, '', pos, selectedKey(fence));
      filterInput?.focus();
    }
  } else {
    close(container);
  }
}

/** Hides the popover and, by default, returns focus to its trigger — the
 * contract Escape and a completed selection share. An outside click or a
 * Tab-away passes `returnFocus: false`, because forcing focus back would
 * fight wherever the user actually sent it. */
function close(container: HTMLElement, options: { returnFocus?: boolean } = {}): void {
  const { returnFocus = true } = options;
  const { popover, trigger } = widgetParts(container);
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
 * the old table bar — its own comment calls this out as the reason the
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

    const { trigger } = widgetParts(container);
    if (trigger) {
      const newLabel = triggerLabel(choice.id, labels);
      trigger.textContent = newLabel;
      trigger.setAttribute('aria-label', `${labels.trigger}: ${newLabel}`);
    }
  }

  close(container);
  view.focus();
}

/** `Enter`/`Space` on the widget: resolves the option `aria-activedescendant`
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
