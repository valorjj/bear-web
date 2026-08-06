import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import App from './App';

describe('App', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the application name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'bear-web' })).toBeInTheDocument();
  });

  it('sets the dark theme attribute when the toggle is pressed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('returns to the light theme when toggled twice', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
