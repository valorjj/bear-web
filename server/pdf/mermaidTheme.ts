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
 * (dumped SVGs for all six themed types, and — for the text rule below —
 * `getComputedStyle` on real label elements, not just a `class` read), not
 * written from memory. Several things the obvious selector list gets wrong
 * at this version, in case a future bump reopens the question:
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
 * - A bare `text` selector in the text rule is NOT enough. Mermaid's own
 *   stylesheet carries `#d .label text, #d span { fill:#333 }` at
 *   specificity (1,1,1) against this file's un-prefixed `text` at (1,0,1) —
 *   Mermaid's rule wins regardless of source order, because specificity is
 *   compared before order ever matters. Measured with `getComputedStyle`
 *   before this was added: flowchart node labels ("Start"/"End") and the
 *   edge label, plus class/state/ER label text, all computed to `#333`
 *   instead of the theme's text colour, and the sequence actor name
 *   computed to `#fff4dd` — Mermaid's own box fill, not a text colour at
 *   all. `.label text`, `.label span` and `text.actor` bring this file's
 *   specificity up to par (or above, for `text.actor`'s compound form), and
 *   — because this stylesheet is appended AFTER Mermaid's own — a tied
 *   specificity then resolves by source order, in this file's favour.
 * - `fill` is an inherited SVG property, so styling a `<text>` element is
 *   normally enough — its child `<tspan>` glyphs inherit the value. THREE
 *   elements break that inheritance: Mermaid's own stylesheet carries
 *   `#d text.actor > tspan`, `#d .noteText > tspan` and
 *   `#d .loopText > tspan` rules at specificity (1,1,2), which is HIGHER
 *   than either `text.actor` (1,1,1) or the bare `tspan` (1,0,1) this file
 *   already had — so the actor name, a sequence note's text and a loop's
 *   condition text all still computed to `#333` (`#fff4dd` for the actor)
 *   even after the fix above, because the glyphs live in the tspan, not the
 *   text element the earlier fix targeted. Checked and NOT needed for
 *   `.labelText` (the fixed "loop"/"alt"/"opt" word never gets a tspan, even
 *   when a long condition on the SAME diagram wraps its own text into one —
 *   verified by rendering both) or `.sectionTitle` (Gantt-only, outside the
 *   six themed types, verified absent from all of them). Re-verified by
 *   `getComputedStyle` after adding these three: every element that was
 *   `#333`/`#fff4dd` now resolves to the theme's `--bear-text`, across all
 *   six types AND sequence's note/loop constructs specifically.
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
  .titleText, .pieTitleText, .slice, .legend text, tspan,
  .label text, .label span, text.actor,
  text.actor > tspan, .noteText > tspan, .loopText > tspan {
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
