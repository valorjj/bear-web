import { render } from '@testing-library/react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Icon, renderIconMarkup } from './Icon';

describe('Icon', () => {
  // An icon that is not hidden joins the accessible name of whatever control
  // wraps it. This project has shipped two accessible-name regressions.
  //
  // This asserts on the PROPS `Icon` passes to its glyph, not the rendered DOM
  // attribute. lucide-react's own `Icon` wrapper already defaults
  // `aria-hidden="true"` whenever no `aria-*`/`role`/`title` prop is present at
  // all (see `hasA11yProp` in `lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs`),
  // so asserting on the DOM would still pass even if this component's own
  // `aria-hidden="true"` were deleted — that library fallback would silently
  // cover for it. A stub glyph that records its received props pins this
  // component's own contract instead of the library's.
  it('is hidden from assistive technology', () => {
    let received: Record<string, unknown> = {};
    function StubGlyph(props: Record<string, unknown>): null {
      received = props;
      return null;
    }
    render(<Icon glyph={StubGlyph as unknown as LucideIcon} />);
    expect(received['aria-hidden']).toBe('true');
  });

  it('is not focusable', () => {
    const { container } = render(<Icon glyph={Search} />);
    expect(container.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  });

  it('renders one stroke width for every glyph', () => {
    const { container } = render(<Icon glyph={Search} />);
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75');
  });

  it('renders the default size, and a smaller one on request', () => {
    const { container: md } = render(<Icon glyph={Search} />);
    const { container: sm } = render(<Icon glyph={Search} size="sm" />);
    expect(md.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(sm.querySelector('svg')?.getAttribute('width')).toBe('14');
  });

  it('takes a className so callers can colour it', () => {
    const { container } = render(<Icon glyph={Search} className="text-accent" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('text-accent');
  });
});

/**
 * The whole rendered shape, not just one attribute of one child: every
 * path's `d`, how many paths there are, and the two other attributes
 * `renderIconMarkup` also states as literals (`stroke-width`, `width`). A
 * comparison of only the first `<path>`'s `d` would false-pass a future
 * lucide version that splits a chevron into two paths, or adds a sibling
 * shape — the extra path would simply never be looked at.
 */
function svgShape(container: HTMLElement): {
  ds: (string | null)[];
  pathCount: number;
  strokeWidth: string | null | undefined;
  width: string | null | undefined;
} {
  const svg = container.querySelector('svg');
  const paths = Array.from(container.querySelectorAll('path'));
  return {
    ds: paths.map((p) => p.getAttribute('d')),
    pathCount: paths.length,
    strokeWidth: svg?.getAttribute('stroke-width'),
    width: svg?.getAttribute('width'),
  };
}

describe('renderIconMarkup', () => {
  // `renderIconMarkup` hardcodes `ChevronDown`/`ChevronRight`'s path data
  // rather than calling lucide's own components (see the long comment above
  // `CHEVRON_PATHS` in `Icon.tsx` for why — hooks inside lucide's base `Icon`
  // component make that non-viable without a full React renderer, which is
  // the exact weight avoiding `react-dom/server` was for). These two tests
  // are what keeps that duplicate from silently drifting: they render the
  // REAL lucide components through `@testing-library/react` — a test-only
  // dependency that never reaches the shipped bundle — and compare the WHOLE
  // shape (`svgShape` above), not just one child's `d`, against
  // `renderIconMarkup`'s hardcoded output. A `lucide-react` version bump that
  // changes either glyph's shape — a different path, an added sibling shape,
  // a different stroke width or size — fails one of these instead of
  // shipping a silently wrong icon.
  it('matches the real ChevronDown glyph', () => {
    const { container: real } = render(<Icon glyph={ChevronDown} />);

    const built = document.createElement('div');
    built.innerHTML = renderIconMarkup(ChevronDown);

    expect(svgShape(built)).toEqual(svgShape(real));
  });

  it('matches the real ChevronRight glyph', () => {
    const { container: real } = render(<Icon glyph={ChevronRight} />);

    const built = document.createElement('div');
    built.innerHTML = renderIconMarkup(ChevronRight);

    expect(svgShape(built)).toEqual(svgShape(real));
  });

  it('throws for a glyph with no registered path data', () => {
    expect(() => renderIconMarkup(Search)).toThrow();
  });
});
