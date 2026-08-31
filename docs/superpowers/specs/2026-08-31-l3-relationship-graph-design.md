# L3 — The relationship graph

Written 2026-08-31, the same day L2 shipped. The third of the L-series. The
roadmap's ordering argument was that L3 is a **projection of data the app
already holds** — L2's `noteLinks` index — rather than a new runtime, and that
it should be built while that index is fresh.

## Purpose

L2 made a note reachable from another note. It did not make the vault
knowable. `BacklinksPanel` answers "what points here?" one note at a time,
which is navigation; nothing answers "what does my body of work look like?"

L3 is an **overview instrument, not a navigator**. The user opens it to learn
something about their own notes that no list can show: what is central, what is
isolated, where the clusters are, and what they keep referring to but never
wrote. Success is the reaction *"huh — those eight notes are an island"*.

That framing was chosen deliberately over two alternatives, and it decides
everything below. It is **not** primarily a way to jump to a note (that would
favour big click targets and filtering over layout quality) and it is **not** a
local neighbourhood view of the open note (that would be `BacklinksPanel`
grown up, and would favour a docked panel over a full surface).

## Why this is cheap HERE, specifically

Not because graphs are easy. Because the expensive halves are already built:

- **The edge list exists.** `notes.allLinkRows()` returns every
  `{noteId, toTitle}` row of the derived index, and `reindexNote` guarantees it
  is current through create, save, restore and the sync apply path alike.
- **The resolution rule exists and is already tested.**
  `src/app/resolveLinkTarget.ts` decides which note a normalized title means
  when several share it — most recently updated wins.
- **The trash rule is already applied.** `rebuildLinkIndex` and the write paths
  keep the index to active notes only, so the graph inherits "no trashed notes"
  without a filter of its own.

What is genuinely new is a layout, a canvas and a surface.

## Measurements taken before deciding

Every number here was measured on this machine on 2026-08-31, not assumed.

**Library cost**, bundled and minified with esbuild:

| Option                                        | gzip        | vs the ~334 KB app |
| --------------------------------------------- | ----------- | ------------------ |
| `d3-force` (simulation only, incl. Barnes-Hut) | **5.6 KB**  | 1.7%               |
| `cytoscape` (full graph engine)                | 141.8 KB    | 42%                |

`d3-force` brings four packages (`d3-force`, `d3-quadtree`, `d3-dispatch`,
`d3-timer`). `cytoscape` is in the same cost class as the Mermaid spike that
got L5 deferred, and buys rendering we do not want — the SVG is ours.

**Settle time**, 300 ticks with link + Barnes-Hut charge + centre + collide:

| Nodes | Edges | Settle    |
| ----- | ----- | --------- |
| 200   | 249   | 130 ms    |
| 500   | 622   | 360 ms    |
| 1 000 | 1 250 | 775 ms    |
| 2 000 | 2 499 | 1 955 ms  |
| 5 000 | 6 249 | 5 432 ms  |

This is the whole reason for the worker threshold below. At the bottom of the
target range the settle is imperceptible; at the top it is two seconds of solid
main-thread computation.

All settle figures were taken in Node, which measures the simulation alone. In
the browser the same ticks compete with paint, so treat these as a floor and
re-check the threshold once `GraphCanvas` exists.

**Determinism is real, and was measured to come from somewhere other than
where it was first credited.** `d3-force`'s initial placement is phyllotaxis
(already deterministic), and `LAYOUT_TICKS` is a fixed 300 — that pair is what
actually makes two runs of the same input produce byte-identical coordinates.
`simulation.randomSource(seededLcg)` is retained as cheap insurance against
`jiggle()` — `(random() - 0.5) * 1e-6`, `forceLink` and `forceCollide`'s only
use of randomness, fired when two nodes coincide exactly — but a graph built
by `buildGraph` never produces an exact coincidence, so `jiggle()` is never
actually called on realistic input. Measured, not assumed: deleting the
`randomSource` call leaves every test passing, and changing `SEED` leaves
every test passing too. What actually protects the screenshots is the
committed golden-fingerprint test in `layoutGraph.test.ts`, which fails on a
tick-count, force-parameter, or node-order change.

## Decisions already taken

### The target scale is 200–2 000 notes

Below 200 nothing here is hard. Above 2 000 the design changes character —
canvas rendering, spatial hit-testing, a quadtree for picking — and that is a
different sub-project. Above the cap the surface **says what it is showing and
why** rather than hanging for six seconds.

### The graph is a full-surface takeover

It replaces the three panes, with its own header. `AppShell` gains one piece of
state, `view: 'notes' | 'graph'`, composing with `phoneScreen` rather than
replacing it. `⇧⌘G` opens and closes; `Esc` closes.

`Mod-Shift-G` was verified unbound in `node_modules/@tiptap`, per the procedure
`useScopeShortcuts`'s docblock already requires, and it matches the existing
`Mod+Shift+…` shape there. Matching is on `event.code`, like every other
binding in that file.

Rejected: a `Dialog` modal (cheapest, but a modal reads as transient and gives
the layout less room), and an editor-pane swap (smallest canvas of the three,
which fights the stated purpose directly).

### Nodes are notes and ghosts. Not tags, and no arrowheads

- **Orphans are included** — notes with no links in either direction. They cost
  nothing and a field of them *is* the finding; excluding them would flatter
  the vault by drawing only what is already connected. They need no special
  placement: with charge and centring forces, unlinked nodes settle into a
  diffuse ring outside the connected core.
- **Ghosts are included** — a `[[Foo]]` where no note resolves to `Foo`. Drawn
  hollow and dashed. This is the vault's to-do list made visible, and it is
  free: the `toTitle` is in the index with no matching note.
- **Tags are NOT nodes.** A two-mode network densifies enormously — one `#work`
  tag on 300 notes is a 300-edge hub that dominates the layout — and it shows
  structure the tag sidebar already shows better.
- **Edges carry no direction.** Arrowheads at 1 000 nodes are noise until you
  zoom far enough in that the overview is gone.

### The scope is the whole vault, ignoring the current selection

Every non-trashed note, regardless of the active tag or smart list. "See the
shape" means the shape of everything; a scoped graph is a different feature.

### The title-resolution rule moves to the data layer

The graph must resolve `toTitle → note id` by exactly the rule a clicked
`[[pill]]` uses, or the picture disagrees with the app. That rule is currently
in `src/app/resolveLinkTarget.ts`, and `src/features/` importing from
`src/app/` is backwards.

`buildTitleIndex(noteIndex) → Map<normalizedTitle, id>` moves to
`src/data/links/titleIndex.ts`; `resolveLinkTarget` delegates to it; the graph
uses it directly. This is data-layer work by the same reasoning that puts
`parseTags` in `src/data/tags/` — it derives an index — and it is the minimum
change that makes the two paths share one rule rather than two copies.

### One new repository method

`notes.allNoteIndex(): Promise<{ id, title, updatedAt }[]>` — the shape
`resolveLinkTarget` already consumes, projecting away `text` so a 2 000-note
vault does not pull megabytes of markdown to draw dots. It sits beside
`allTagRows` / `allLinkRows` / `allNoteTitles` and follows their naming.

### The whole surface is lazy-loaded, and that is structural

Measured on 2026-08-31: `main` is **337,259 B** gzipped against
`scripts/bundleSize.test.ts`'s ceiling of **340,000** — **2,741 B of
headroom**. `d3-force` is 5.6 KB gzipped on its own, so loading the graph
eagerly would breach the ceiling before any first-party code was written.

`GraphView` is therefore reached through a dynamic `import()` behind
`React.lazy`, and `d3-force` is imported only from inside that boundary. Two
consequences worth stating, because both are load-bearing:

- **The bundle guard keeps working unchanged.** It measures the *largest* JS
  asset, so a separate graph chunk is simply not the thing it measures. The
  ceiling should NOT be raised for L3 — if it needs raising, something has
  leaked across the lazy boundary, and that is the finding.
- **This is the app's first code split.** The build currently emits two JS
  assets and Rolldown already warns about the missing split, so the mechanism
  is new here and needs verifying in a real build rather than assumed.

A `Suspense` fallback renders the same `settling` state the layout already
needs, so the chunk fetch and the simulation look like one wait to the user.

### The layout is one pure function with two callers

`layoutGraph(graph) → Map<id, {x, y}>` is pure, synchronous and deterministic.
Below **400 nodes** it runs on the main thread. That figure is measured, not
interpolated — a finer sweep (median of 5 runs each, machine load 3.27) puts
200 nodes at 121 ms, 300 at 202 ms, **400 at 262 ms**, 500 at 339 ms, 600 at
416 ms and 800 at 581 ms. 400 is the last size whose settle stays under the
~250–300 ms a user reads as "instant" rather than "stalled".
Above it, the same module is loaded in a Web Worker and the result posted back;
the worker holds no logic of its own and a failure to start falls back to the
synchronous path.

The point of this split is testability: the expensive half is unit-testable in
Vitest, which **has no `Worker` at all**. A worker-only design would push the
only part of L3 with real math in it into Playwright.

### The graph is a snapshot, not a live subscription

A deliberate deviation from "components subscribe via `useLiveQuery`", and it
needs a ruling so a later session does not "fix" it.

Relayout is not incremental: re-running the simulation moves every node. A live
graph would therefore rearrange itself under the reader's cursor, for up to two
seconds, because a note they cannot see was autosaved. The surface is a
takeover — no note can be edited while it is open — so the only thing that can
change the vault underneath it is a sync pull. Reopening re-snapshots.

Positions are cached in module scope, keyed by a topology hash over
`{node ids, edge pairs}`. Reopening after editing nothing is instant; reopening
after adding one note recomputes honestly.

### Visual encoding

Node **area** scales with degree — radius is `√degree`, clamped — because a
linear radius turns a 14-link hub into a blob that eats its neighbourhood.
Notes fill `--bear-muted`; ghosts are hollow with a dashed `--bear-faint`
stroke; the note that was open when the graph was opened fills `--bear-accent`
as an anchor. Edges are hairlines in `--bear-border`. Every colour is an
existing token, so the graph inherits all sixteen themes and the contrast
harness without new values.

Labels use level-of-detail: below a zoom threshold only nodes above a degree
cutoff are labelled; above it, all are; hover always labels. No collision
detection — it is expensive and zoom makes it unnecessary.

### Interaction

Drag to pan, wheel and pinch to zoom, plus `+` / `−` / reset buttons so zoom is
never wheel-only. Hovering a node dims everything that is not it or a
neighbour; that gesture is what makes a dense graph legible. Clicking a note
closes the graph and opens it. Clicking a **ghost** creates a note with that
title and opens it.

`usePanZoom` goes in `src/lib/` — framework-level behaviour with no product
knowledge, which is that directory's stated test.

### Assistive technology gets the finding, not the dots

1 000 SVG circles are not tab stops and will not be pretended into them. The
canvas is `role="img"` with an `aria-label` stating the finding in words —
*"Relationship graph: 412 notes, 1 250 links, 300 unlinked, 12 links to notes
that don't exist"*. Beside it, the header opens a real focusable list of the
most-linked notes and every ghost, built from `SidebarRow`.

This delivers the actual purpose — what is central, what is orphaned — to
someone who will never see the picture, rather than shipping a decorative black
hole with an accessible name.

## Architecture

```
src/data/links/titleIndex.ts     buildTitleIndex — moved, shared with app
src/data/repositories/notes.ts   + allNoteIndex()
src/lib/usePanZoom.ts            pan/zoom behaviour, no product knowledge
src/features/graph/
  buildGraph.ts                  (noteIndex, linkRows) -> {nodes, edges}   pure
  layoutGraph.ts                 (graph) -> positions   pure, seeded, d3-force
  layoutWorker.ts                ?worker transport, no logic
  useGraphSnapshot.ts            reads, builds, hashes, chooses sync|worker
  GraphView.tsx                  the surface: header, states, a11y list
  GraphCanvas.tsx                the SVG: nodes, edges, labels, hover
src/app/AppShell.tsx             + view: 'notes' | 'graph'
src/app/useScopeShortcuts.ts     + Mod-Shift-KeyG
```

`buildGraph` and `layoutGraph` know nothing of React or the DOM. `GraphCanvas`
knows no math. That split is what makes the interesting half testable.

Four surface states, each rendered distinctly: `building`, `settling`, `ready`,
and `empty`. A vault with notes but **no links is not empty** — it is a field
of orphans, which is a legitimate finding, not an error state.

## Testing

- **`buildGraph`** — ghost minting, degree counting, duplicate-link collapsing,
  self-links, and a property test that its resolution **agrees with
  `resolveLinkTarget`** on the same input. That agreement test is the point of
  the shared `titleIndex`; it is what catches the two drifting apart later.
- **The edge invariant gets its own test:** every edge endpoint must exist as a
  node. `forceLink` throws on an id it cannot find, so a ghost-minting bug does
  not render a wrong graph — it takes down the surface.
- **`layoutGraph`** — the same input laid out twice is identical; every
  coordinate is finite; two nodes at identical starting positions do not
  produce `NaN`. The finiteness assertion is not tidiness: **a `NaN` position
  renders as an invisible node with no error and no crash**, the same silent
  shape as `parseColour`'s `NaN` and an unmapped `.hljs-*` class.
- **Component** — the four states, the `aria-label`'s counts, the hubs list.
- **Playwright (`e2e/graph.spec.ts`)** — the worker path (jsdom has no
  `Worker`, so unit tests only ever exercise the synchronous fallback), pointer
  pan and zoom (no `setPointerCapture` in jsdom), and label level-of-detail
  across a zoom threshold.
- **`npm run shots`** gains one shot: 240 files → 256. Worth having only
  because the layout is deterministic; a shot of an animated settle is noise.
- **`npm run measure`** gains the graph header, for the same reason the
  note-list header is measured — headers are exactly what drifted unnoticed
  through J2a and I.

## Risks, in the order they are worth worrying about

1. **The worker chunk in a production build.** `?worker` emits a separate
   chunk that `npm run dev` serves differently from `npm run build`, so a
   broken worker URL will not appear in dev. The sub-path hazard that would
   normally make this severe does **not** apply here — `vite.config.ts` sets
   `base: '/'` and `public/CNAME` is `markflowing.com`, so the app is served
   from a domain root, and the conditional base that once varied under
   `GITHUB_ACTIONS` is gone. It still has to be verified against
   `npm run build && npm run preview`, and per the existing trap
   `lsof -ti:4173 | xargs -r kill -9` first, or the preview silently serves a
   stale build.
2. **A leak across the lazy boundary.** A single eager `import` of `d3-force`,
   or of `GraphView` from a module the shell already loads, silently pulls the
   whole feature back into `main` — where there are 2 741 bytes of room and it
   needs more. The symptom is a bundle-guard failure with no obvious culprit,
   so measure `main` on both sides of the branch as that file's convention
   requires, and treat a needed ceiling raise as evidence of the leak rather
   than as the fix.
3. **4 500 SVG elements and hover dimming.** Per-node React state would thrash.
   The mitigation is one data attribute on the container plus CSS. Measure it;
   do not assume it.
4. **The snapshot deviation** from `useLiveQuery` needs a ruling in
   `docs/rulings/notes-lifecycle.md`, or it reads as an oversight.
5. **Scale beyond the cap** must degrade by saying so, never by hanging.

## Out of scope

- Tag nodes, edge direction, and edge weighting.
- A scoped or filtered graph (whole vault only).
- Live updating while the surface is open.
- Canvas or WebGL rendering, and anything the 2 000-node cap implies.
- Saving a layout, or manual node positioning.
- Exporting the graph as an image.
