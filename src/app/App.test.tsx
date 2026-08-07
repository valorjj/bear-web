import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  it('renders the shell inside an i18n provider', () => {
    render(<App />);

    // Three labelled regions, in whichever locale was detected.
    expect(screen.getAllByRole('region')).toHaveLength(3);
  });

  it('does not throw for a missing provider', () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
