import { render } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';

describe('Icon', () => {
  // An icon that is not hidden joins the accessible name of whatever control
  // wraps it. This project has shipped two accessible-name regressions.
  it('is hidden from assistive technology', () => {
    const { container } = render(<Icon glyph={Search} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
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
