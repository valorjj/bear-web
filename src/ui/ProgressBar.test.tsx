import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<ProgressBar label="Exporting PDF" active={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders an indeterminate progressbar with the given label when active', () => {
    render(<ProgressBar label="Exporting PDF" active={true} />);
    const bar = screen.getByRole('progressbar', { name: 'Exporting PDF' });
    // Indeterminate: no `aria-valuenow`, per the ARIA APG.
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-busy', 'true');
  });
});
