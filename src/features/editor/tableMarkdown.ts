import type { JSONContent } from '@tiptap/core';
import { Table, renderTableToMarkdown } from '@tiptap/extension-table';

type RenderHelpers = Parameters<typeof renderTableToMarkdown>[1];

/**
 * Escapes every `|` in a cell's ALREADY-RENDERED Markdown, so a pipe the user
 * typed inside a cell survives as content rather than becoming a column break.
 *
 * `renderTableToMarkdown` does not do this. The package exports
 * `escapeTableCellPipes`, but only its PARSE path uses it (through
 * `preprocessTablePipes`), and even there only inside code spans; the render path
 * emits cell text verbatim.
 *
 * The consequence is data loss rather than cosmetics. `| x \| y | z |` parses to
 * two cells — `x | y` and `z` — and serializes back to `| x | y | z |`, which is
 * three cells in a two-column table. Normalizing THAT drops `z` entirely.
 *
 * **Timing is the whole trick, and the obvious version is wrong.** Escaping the
 * document's text nodes before handing them to `renderTableToMarkdown` fails: the
 * text renderer runs afterwards and escapes the backslash we just added, so
 * `x | y` becomes `x \\| y`, which re-parses as a literal backslash followed by a
 * column break — the same lost cell by a longer route. The escape has to happen
 * after rendering, which is why this wraps `renderChildren` rather than the node.
 *
 * The lookbehind keeps it idempotent if the renderer ever starts escaping pipes
 * itself.
 */
function withPipeEscapingCells(helpers: RenderHelpers): RenderHelpers {
  return {
    ...helpers,
    renderChildren: (content: Parameters<RenderHelpers['renderChildren']>[0]) =>
      helpers.renderChildren(content).replace(/(?<!\\)\|/g, '\\|'),
  };
}

/**
 * The official table node, with two corrections to its Markdown output.
 *
 * 1. **Pipes in cell text are escaped** — see above.
 *
 * 2. **The surrounding newlines are trimmed.** `renderTableToMarkdown` wraps its
 *    output in newlines and `MarkdownManager` already joins top-level blocks with
 *    a blank line, so a table in the middle of a note gained a blank line above
 *    and below itself: `# Shopping\n\n| item` came back as
 *    `# Shopping\n\n\n| item`.
 *
 * Both defects are invisible to an idempotence-only assertion, in different ways.
 * The extra newline is *stable*, so serialize-parse-serialize reaches a fixed
 * point on the first pass and every idempotence check passes. The pipe bug is not
 * stable, but appears only on an input no fidelity string covered — precisely the
 * blind spot CLAUDE.md records for this suite, and why tables needed their own
 * stability entries rather than relying on the canonical one.
 *
 * Trimming only the edges is deliberately narrower than a general
 * "collapse blank runs" pass in `serializeMarkdown`, which would corrupt a fenced
 * code block containing blank lines.
 */
export const MarkdownTable = Table.extend({
  renderMarkdown: (node: JSONContent, helpers: RenderHelpers) =>
    renderTableToMarkdown(node, withPipeEscapingCells(helpers)).replace(/^\n+|\n+$/g, ''),
});
