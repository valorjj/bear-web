import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';
import type { Viewport } from '@/lib/panZoom';

import { buildGraph } from './buildGraph';
import { GraphCanvas, LABEL_DEGREE_THRESHOLD, LABEL_SCALE_THRESHOLD } from './GraphCanvas';
import { layoutGraph } from './layoutGraph';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

const REST_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

function renderCanvas(
  onSelect = vi.fn(),
  activeId: string | null = null,
  viewport: Viewport = REST_VIEWPORT,
) {
  // A hub with 4 neighbours (above the label threshold) and a lone orphan.
  const index = [
    note('hub', 'Hub'),
    note('a', 'A'),
    note('b', 'B'),
    note('c', 'C'),
    note('d', 'D'),
    note('lonely', 'Lonely'),
  ];
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ noteId: id, toTitle: 'hub' }));
  const graph = buildGraph(index, [...rows, { noteId: 'hub', toTitle: 'nowhere' }]);

  const view = render(
    <I18nProvider locale="en">
      <GraphCanvas
        graph={graph}
        positions={layoutGraph(graph)}
        activeId={activeId}
        onSelect={onSelect}
        label="Relationship graph"
        viewport={viewport}
        onPointerDown={vi.fn()}
        onPointerMove={vi.fn()}
        onPointerUp={vi.fn()}
        onWheel={vi.fn()}
      />
    </I18nProvider>,
  );
  return { ...view, graph, onSelect };
}

describe('GraphCanvas', () => {
  it('draws one element per node and one per edge', () => {
    const { container, graph } = renderCanvas();

    expect(container.querySelectorAll('[data-node]')).toHaveLength(graph.nodes.length);
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(graph.edges.length);
  });

  it('marks a ghost node distinctly from a note', () => {
    const { container } = renderCanvas();

    const ghosts = container.querySelectorAll('[data-kind="ghost"]');
    expect(ghosts).toHaveLength(1);
    expect(container.querySelectorAll('[data-kind="note"]')).toHaveLength(6);
  });

  it('labels only nodes at or above the degree threshold at rest', () => {
    // Asserting a COUNT that changes with the rule, not merely that some label
    // exists — a presence assertion passes against a canvas that labels
    // everything, which is the bug this threshold exists to prevent.
    const { container, graph } = renderCanvas();

    const labelled = container.querySelectorAll('[data-label]');
    const expected = graph.nodes.filter((n) => n.degree >= LABEL_DEGREE_THRESHOLD).length;

    expect(labelled).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(graph.nodes.length);
  });

  it('reports the clicked node to its caller', async () => {
    const { container, onSelect } = renderCanvas();

    const hub = container.querySelector('[data-node="hub"]')!;
    await userEvent.click(hub);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'hub', kind: 'note' }));
  });

  it('marks the active node so it can be found again', () => {
    const { container } = renderCanvas(vi.fn(), 'hub');

    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-node')).toBe('hub');
  });

  it('labels more nodes above the zoom threshold than at rest', () => {
    // Asserting a count that CHANGES with the rule, not merely that the
    // zoomed-in render has some labels — the viewport is now injectable, so
    // this is cheap and pins the LOD behaviour to the real threshold rather
    // than to a component-internal default.
    const atRest = renderCanvas(vi.fn(), null, REST_VIEWPORT);
    const restCount = atRest.container.querySelectorAll('[data-label]').length;

    const zoomedIn = renderCanvas(vi.fn(), null, { x: 0, y: 0, scale: LABEL_SCALE_THRESHOLD });
    const zoomedCount = zoomedIn.container.querySelectorAll('[data-label]').length;

    expect(zoomedCount).toBeGreaterThan(restCount);
  });
});
