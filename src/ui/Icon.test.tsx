import { render } from '@testing-library/react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';

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
