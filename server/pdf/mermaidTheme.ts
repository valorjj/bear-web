/**
 * Mermaid's `themeCSS`, appended VERBATIM into the rendered SVG's own
 * `<style>` element.
 *
 * Verbatim is the whole trick. Mermaid's `themeVariables` go through its
 * colour maths (khroma), which cannot evaluate `var(--bear-muted)` and would
 * produce garbage; `themeCSS` is not touched, so these references survive
 * into the SVG and resolve against the PAGE the SVG is inlined into. One
 * cached render therefore serves all sixteen themes and follows a live theme
 * switch, with no second render and no cache key per theme.
 *
 * CSS beats presentation attributes, which is why these rules win over the
 * `fill=` and `stroke=` Mermaid inlines from its own palette.
 *
 * Token choice: `--bear-surface` for node fills, not `--bear-bg`. The two are
 * deliberately different colours (see `tokens.css`'s "`bg` and `surface` must
 * DIFFER" note) — a node is a raised box floating over the diagram's base
 * background, the same relationship an editor toolbar pill has to the editor
 * canvas. Edge-label backdrops use `--bear-bg` instead, matching the base the
 * label sits directly on rather than a raised one.
 *
 * THE THEMED SET IS NAMED, AND IT IS NOT EVERY DIAGRAM TYPE. Mermaid's class
 * names differ per type; these selectors cover flowchart, sequence, state,
 * class, ER and pie. Every other type still renders and keeps Mermaid's base
 * palette — legible, but not part of the theme. Growing this is additive:
 * add selectors, bump `DIAGRAM_RENDER_VERSION` in
 * `src/data/diagrams/key.ts` so every cached SVG re-renders, and add a shot.
 *
 * Every selector below was checked against Mermaid 11.17.2's REAL output
 * (dumped SVGs for all six themed types), not written from memory. Three
 * things the obvious selector list gets wrong at this version, in case a
 * future bump reopens the question:
 *
 * - `.actor` is on BOTH the participant's box (`rect.actor.actor-top` /
 *   `.actor-bottom`) and its name label (`text.actor.actor-box`). A bare
 *   `.actor` rule beats the generic `text` rule below on specificity (a
 *   class selector outranks a type selector), so it would recolour the name
 *   to the BOX fill instead of the text colour — verified by rendering a
 *   sequence diagram and reading the actual class list, not by inspection.
 *   Scoped to `rect.actor` for this reason.
 * - classDiagram relationship lines carry `.relation`, not `.relationshipLine`
 *   — that name is real, but only for erDiagram. Without `.relation` a
 *   classDiagram's connecting lines silently keep Mermaid's own stroke.
 * - `.er.entityBox`, `.classGroup rect`, `.stateGroup rect`, `.classTitle`,
 *   `.stateLabel`, `.edgePath .path` and `.actor-line + text` all appear
 *   in Mermaid's own boilerplate `<style>` block (which this file's output
 *   sits beside, not inside) but are never actually placed on an element in
 *   11.17.2's output for these six types — grep-checked against real
 *   renders. Dropped rather than kept as decoration, so this list only
 *   claims what was verified. State/class/ER nodes and their labels are
 *   still covered: they render through the SAME `.node` / `.cluster` /
 *   generic-`text` machinery flowchart uses under the hood.
 */
export const MERMAID_THEME_CSS = `
  .node rect, .node circle, .node ellipse, .node polygon, .node path,
  .cluster rect, rect.actor, .labelBox, .note {
    fill: var(--bear-surface);
    stroke: var(--bear-border);
  }
  .flowchart-link, .messageLine0, .messageLine1,
  .relationshipLine, .relation, .transition, line, .divider {
    stroke: var(--bear-muted);
  }
  .arrowheadPath, marker path, .marker {
    fill: var(--bear-muted);
    stroke: var(--bear-muted);
  }
  text, .nodeLabel, .edgeLabel, .messageText, .loopText, .noteText,
  .titleText, .pieTitleText, .slice, .legend text, tspan {
    fill: var(--bear-text);
    color: var(--bear-text);
  }
  .edgeLabel rect, .labelBkg, .edgeLabel .label rect {
    fill: var(--bear-bg);
  }
  .cluster text, .cluster-label text {
    fill: var(--bear-muted);
  }
`;
