import { Extension, InputRule } from '@tiptap/core';

/**
 * Promotes a bullet list item to a task item when `[ ] ` or `[x] ` is typed at
 * its start.
 *
 * Without this, typing `- [ ] milk` produces a plain bullet holding the
 * literal text `[ ] milk`: StarterKit's `bulletList` rule fires on `- ` first,
 * and `TaskItem`'s own `wrappingInputRule` cannot wrap a paragraph that is
 * already inside a `listItem`. `TaskItem`'s rule still owns the plain-paragraph
 * case; this one only covers the already-a-bullet case it cannot reach.
 *
 * The `^` anchor is against the start of the text block, which is what keeps
 * this from firing mid-paragraph.
 */
export const TaskItemPromotion = Extension.create({
  name: 'taskItemPromotion',

  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX])\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.node(-1)?.type.name !== 'listItem') return null;
          if ($from.node(-2)?.type.name !== 'bulletList') return null;

          const checked = match[1]?.toLowerCase() === 'x';
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .updateAttributes('taskItem', { checked })
            .run();
          return undefined;
        },
      }),
    ];
  },
});
