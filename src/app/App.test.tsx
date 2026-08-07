import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en } from '@/i18n/en';

import App from './App';

describe('App', () => {
  it('renders the three-pane shell when the database is ready', () => {
    render(<App status="ready" />);

    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the warning above the shell when running in memory', () => {
    render(<App status="memory" />);

    expect(screen.getAllByRole('region')).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent(en['database.memory.title']);
  });
});
