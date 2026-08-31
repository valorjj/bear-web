import { type ReactElement, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { notes } from '@/data';
import { useT } from '@/i18n';
import { boundsOf, frameBounds, type Viewport } from '@/lib/panZoom';
import { usePanZoom } from '@/lib/usePanZoom';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ChevronLeft, Icon, Maximize2, Minus, Plus } from '@/ui/Icon';
import { SidebarRow } from '@/ui/SidebarRow';

import type { Graph, GraphNode } from './buildGraph';
import { GraphCanvas } from './GraphCanvas';
import type { Point } from './layoutGraph';
import { useGraphSnapshot } from './useGraphSnapshot';

export interface GraphViewProps {
  /** The note open behind the graph, drawn as an anchor. */
  activeId: string | null;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}

/** How many hubs the text alternative lists. Enough to see the shape, few enough to read. */
const HUB_LIMIT = 10;

/**
 * The graph surface: a header, the canvas, and a text alternative.
 *
 * The text alternative is not a courtesy. This surface's entire purpose is to
 * answer "what is central, what is isolated" — and 1,000 SVG circles are not
 * tab stops. Rather than pretend they are, the canvas carries the finding in
 * its accessible name and the header opens the same finding as real focusable
 * rows. Someone who never sees the picture gets the answer the picture exists
 * to give.
 */
export function GraphView({ activeId, onClose, onOpenNote }: GraphViewProps): ReactElement {
  const t = useT();
  const snapshot = useGraphSnapshot();
  const [summaryOpen, setSummaryOpen] = useState(false);

  const openNode = useCallback(
    async (node: GraphNode) => {
      if (node.kind === 'note') {
        onOpenNote(node.id);
        return;
      }
      // A ghost is a title someone has referred to and never written. Choosing
      // it writes it — which is what makes the graph the vault's to-do list.
      const created = await notes.create(`# ${node.title}\n\n`);
      onOpenNote(created.id);
    },
    [onOpenNote],
  );

  const graph =
    snapshot.status === 'settling' || snapshot.status === 'ready' ? snapshot.graph : null;
  const capped = snapshot.status === 'ready' ? snapshot.capped : 0;

  const summary = useMemo(() => {
    if (graph === null) return null;
    const noteNodes = graph.nodes.filter((n) => n.kind === 'note');
    const ghosts = graph.nodes.filter((n) => n.kind === 'ghost');
    return {
      notes: noteNodes.length,
      links: graph.edges.length,
      unlinked: noteNodes.filter((n) => n.degree === 0).length,
      ghosts,
      hubs: [...noteNodes].sort((a, b) => b.degree - a.degree).slice(0, HUB_LIMIT),
    };
  }, [graph]);

  const canvasLabel =
    summary === null
      ? t('graph.title')
      : [
          `${t('graph.title')}: ${summary.notes}${t('graph.summary.notes')}`,
          `${summary.links}${t('graph.summary.links')}`,
          `${summary.unlinked}${t('graph.summary.unlinked')}`,
          `${summary.ghosts.length}${
            summary.ghosts.length === 1 ? t('graph.summary.ghostsOne') : t('graph.summary.ghosts')
          }`,
          // Only when the vault actually exceeded NODE_CAP: a vault under the
          // cap must not announce "0 notes not shown" on every open. Without
          // this fragment a 3,000-note vault's accessible name silently
          // reported "2000 notes" with no qualification at all.
          ...(capped > 0 ? [`${capped}${t('graph.capped')}`] : []),
        ].join(', ');

  return (
    <div className="bg-canvas text-text flex h-full w-full flex-col">
      <header className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <Button onClick={onClose} label={t('graph.back')} variant="ghost" size="sm">
          <Icon glyph={ChevronLeft} />
        </Button>
        <h1 className="text-ui-sm font-semibold">{t('graph.title')}</h1>
        <div className="flex-1" />
        <Button
          onClick={() => setSummaryOpen((open) => !open)}
          variant="ghost"
          size="sm"
          ariaExpanded={summaryOpen}
        >
          {t('graph.summary')}
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {snapshot.status === 'empty' && (
            <EmptyState title={t('graph.empty.title')} body={t('graph.empty.body')} />
          )}
          {(snapshot.status === 'building' || snapshot.status === 'settling') && (
            <div className="text-muted flex h-full items-center justify-center text-ui-sm">
              {t('graph.settling')}
            </div>
          )}
          {snapshot.status === 'ready' && (
            <GraphCanvasFrame
              label={canvasLabel}
              graph={snapshot.graph}
              positions={snapshot.positions}
              capped={snapshot.capped}
              activeId={activeId}
              onSelect={(node) => void openNode(node)}
            />
          )}
        </div>

        {summaryOpen && summary !== null && (
          <nav
            aria-label={t('graph.summary')}
            className="border-border w-64 shrink-0 overflow-y-auto border-l p-2"
          >
            <h2 className="text-faint px-2 pt-1 text-ui-xs font-semibold">{t('graph.hubs')}</h2>
            <ul>
              {summary.hubs.map((node) => (
                <SidebarRow
                  key={node.id}
                  label={node.title === '' ? t('note.untitled') : node.title}
                  count={node.degree}
                  selected={false}
                  onSelect={() => void openNode(node)}
                />
              ))}
            </ul>
            {summary.ghosts.length > 0 && (
              <>
                <h2 className="text-faint px-2 pt-3 text-ui-xs font-semibold">
                  {t('graph.ghosts')}
                </h2>
                <ul>
                  {summary.ghosts.map((node) => (
                    <SidebarRow
                      key={node.id}
                      label={node.title}
                      count={node.degree}
                      selected={false}
                      onSelect={() => void openNode(node)}
                    />
                  ))}
                </ul>
              </>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

/**
 * Split out ONLY so the zoom controls can sit beside the canvas and share its
 * `usePanZoom` state. Defined at module scope, never inside `GraphView`'s
 * body: a component declared in a render body is a new type every render, and
 * React unmounts and remounts its whole subtree each time — the trap
 * `NoteRowMenu`'s `Item` cost this project once already.
 *
 * `GraphCanvas` is fully controlled — it does not call `usePanZoom` itself —
 * so this frame owns the hook and passes `viewport` plus the four pointer/
 * wheel handlers down, and wires the three zoom buttons to the hook's own
 * `zoomBy`/`reset` rather than leaving them inert.
 *
 * It also owns FRAMING: `layoutGraph` centres the layout on graph-space
 * `(0, 0)`, which means nothing about where that lands on screen until this
 * component measures its own container and computes a `Viewport` that
 * centres the layout's actual bounding box inside it (`frameBounds`, in
 * `src/lib/panZoom.ts`). Before this existed, every session opened with
 * graph-space origin pinned to the container's top-left corner, so roughly
 * half of any real layout rendered off-screen until panned by hand.
 */
function GraphCanvasFrame({
  label,
  graph,
  positions,
  capped,
  activeId,
  onSelect,
}: {
  label: string;
  graph: Graph;
  positions: Map<string, Point>;
  capped: number;
  activeId: string | null;
  onSelect: (node: GraphNode) => void;
}): ReactElement {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable across re-renders while `positions` itself is (it only changes
  // once, when `useGraphSnapshot` moves from `settling` to `ready`), so this
  // does not fight a reader's own pan/zoom on every unrelated re-render.
  const bounds = useMemo(() => boundsOf([...positions.values()]), [positions]);

  const [frame, setFrame] = useState<Viewport>({ x: 0, y: 0, scale: 1 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    // An unmeasured (zero-size) container — true under jsdom, which lays
    // nothing out — leaves `frame` at the placeholder rather than computing
    // a nonsense scale from a division by a near-zero size.
    if (el === null || el.clientWidth === 0 || el.clientHeight === 0) return;
    setFrame(frameBounds(bounds, el.clientWidth, el.clientHeight));
  }, [bounds]);

  const panZoom = usePanZoom(frame);

  const zoomCenter = useCallback(() => {
    const el = containerRef.current;
    return el === null ? { x: 0, y: 0 } : { x: el.clientWidth / 2, y: el.clientHeight / 2 };
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <GraphCanvas
        graph={graph}
        positions={positions}
        activeId={activeId}
        onSelect={onSelect}
        label={label}
        viewport={panZoom.viewport}
        onPointerDown={panZoom.onPointerDown}
        onPointerMove={panZoom.onPointerMove}
        onPointerUp={panZoom.onPointerUp}
        onWheel={panZoom.onWheel}
      />
      {capped > 0 && (
        <p className="text-faint absolute bottom-2 left-2 text-ui-xs">
          {capped}
          {t('graph.capped')}
        </p>
      )}
      <div className="absolute right-2 bottom-2 flex gap-1">
        <Button
          onClick={() => panZoom.zoomBy(0.8, zoomCenter())}
          label={t('graph.zoomOut')}
          variant="ghost"
          size="sm"
        >
          <Icon glyph={Minus} />
        </Button>
        <Button
          onClick={() => panZoom.zoomBy(1.25, zoomCenter())}
          label={t('graph.zoomIn')}
          variant="ghost"
          size="sm"
        >
          <Icon glyph={Plus} />
        </Button>
        <Button onClick={panZoom.reset} label={t('graph.zoomReset')} variant="ghost" size="sm">
          <Icon glyph={Maximize2} />
        </Button>
      </div>
    </div>
  );
}

export default GraphView;
