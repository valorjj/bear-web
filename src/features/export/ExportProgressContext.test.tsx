import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ExportProgressProvider, useExportProgress } from './ExportProgressContext';

function Probe(): ReactElement {
  const { pending, begin, end } = useExportProgress();
  return (
    <div>
      <span data-testid="pending">{pending ? 'true' : 'false'}</span>
      <button type="button" onClick={begin}>
        begin
      </button>
      <button type="button" onClick={end}>
        end
      </button>
    </div>
  );
}

describe('ExportProgressContext', () => {
  it('throws when read outside a provider', () => {
    // Swallow the expected console.error React logs for a render that throws.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useExportProgress requires an ExportProgressProvider');
    spy.mockRestore();
  });

  it('starts not pending, and flips to pending on begin()', () => {
    render(
      <ExportProgressProvider>
        <Probe />
      </ExportProgressProvider>,
    );
    expect(screen.getByTestId('pending')).toHaveTextContent('false');

    act(() => screen.getByText('begin').click());
    expect(screen.getByTestId('pending')).toHaveTextContent('true');
  });

  it('only clears once every begin() has a matching end() — a count, not a boolean', () => {
    render(
      <ExportProgressProvider>
        <Probe />
      </ExportProgressProvider>,
    );

    // Two overlapping exports, e.g. one started before a note switch, one
    // started after — see the docblock on `ExportProgressProvider` for why
    // this is a count rather than a boolean.
    act(() => screen.getByText('begin').click());
    act(() => screen.getByText('begin').click());
    expect(screen.getByTestId('pending')).toHaveTextContent('true');

    act(() => screen.getByText('end').click());
    // One export is still in flight.
    expect(screen.getByTestId('pending')).toHaveTextContent('true');

    act(() => screen.getByText('end').click());
    expect(screen.getByTestId('pending')).toHaveTextContent('false');
  });

  it('never goes negative on an extra end()', () => {
    render(
      <ExportProgressProvider>
        <Probe />
      </ExportProgressProvider>,
    );

    act(() => screen.getByText('end').click());
    expect(screen.getByTestId('pending')).toHaveTextContent('false');

    act(() => screen.getByText('begin').click());
    expect(screen.getByTestId('pending')).toHaveTextContent('true');
  });
});
