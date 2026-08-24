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

function renderOptions(
  list: HTMLUListElement,
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
  fence: string | null,
  filter: string,
): void {
  list.replaceChildren();

  const query = filter.trim().toLowerCase();
  const activeId = resolveLanguage(fence)?.id ?? null;
  const matches = choices().filter((choice) => {
    const label = choice.id === null ? labels.none : choice.label;
    return label.toLowerCase().includes(query);
  });

  if (matches.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'bear-code-language-empty';
    empty.textContent = labels.empty;
    list.appendChild(empty);
    return;
  }

  for (const choice of matches) {
    const label = choice.id === null ? labels.none : choice.label;
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.setAttribute('data-code-language-option', choice.id ?? '');
    item.setAttribute('aria-selected', String(choice.id === activeId));
    item.textContent = label;
    list.appendChild(item);
  }
}

function controlElement(
  labels: NonNullable<CodeLanguageControlsOptions['codeLabels']>,
  fence: string | null,
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

  popover.append(filterInput, list);
  container.append(trigger, popover);

  renderOptions(list, labels, fence, '');

  return container;
}

/**
 * A trigger button, floating before the code block the caret is in, that
 * opens a filterable list of the twelve known languages plus "plain text".
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
              Decoration.widget(pos, () => controlElement(labels, fence), {
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
                choose(view, option);
                return true;
              }

              // A click anywhere else inside the widget (the popover's own
              // background) must not fall through to the editor and move
              // the caret, but it is not an activation either.
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

              renderOptions(list, labels, fence, filterInput.value);
              return true;
            },

            keydown(_view, event) {
              if (event.key !== 'Escape') return false;
              const target = event.target as HTMLElement | null;
              const container = target?.closest<HTMLElement>('.bear-code-language');
              if (!container) return false;

              close(container);
              return true;
            },
          },
        },
      }),
    ];
  },
});

/** Opens or closes the popover attached to `trigger`, focusing the filter
 * input on open and re-rendering its options against the block's current
 * fence, so a stale list from a previous open never lingers. */
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
    if (list) renderOptions(list, labels, fence, '');

    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    filterInput?.focus();
  } else {
    close(container);
  }
}

/** Hides the popover and returns focus to its trigger — the contract
 * Escape and a completed selection share. */
function close(container: HTMLElement): void {
  const popover = container.querySelector<HTMLElement>('.bear-code-language-popover');
  const trigger = container.querySelector<HTMLElement>('[data-code-language="trigger"]');
  if (popover) popover.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.focus();
}

/**
 * Applies the clicked option's language to the code block the popover
 * belongs to, unless doing so would be a no-op (see `isNoOp`), then closes
 * the popover and restores focus to the editor.
 */
function choose(view: EditorView, option: HTMLElement): void {
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
  }

  close(container);
  view.focus();
}
