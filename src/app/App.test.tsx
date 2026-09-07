import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LANDING_SEEN_KEY } from '@/features/landing';
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

describe('the landing gate', () => {
  it('renders the landing screen when the gate is open', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    render(<App status="ready" />);
    expect(screen.getByRole('heading', { name: 'markflowing' })).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('renders the app shell when the gate is closed', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    render(<App status="ready" />);
    expect(screen.queryByRole('heading', { name: 'markflowing' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(3);
  });
});
