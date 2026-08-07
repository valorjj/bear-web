import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '@/i18n';
import { en } from '@/i18n/en';

import { AppShell } from './AppShell';

function renderShell() {
  return render(
    <I18nProvider locale="en">
      <AppShell />
    </I18nProvider>,
  );
}

describe('AppShell', () => {
  it('renders all three panes as labelled regions', () => {
    renderShell();

    expect(screen.getByRole('region', { name: en['pane.sidebar'] })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: en['pane.noteList'] })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: en['pane.editor'] })).toBeInTheDocument();
  });

  it('shows an empty state in every pane', () => {
    renderShell();

    expect(screen.getByText(en['sidebar.empty.title'])).toBeInTheDocument();
    expect(screen.getByText(en['noteList.empty.title'])).toBeInTheDocument();
    expect(screen.getByText(en['editor.empty.title'])).toBeInTheDocument();
  });

  it('renders a resizer between each adjacent pair of panes', () => {
    renderShell();

    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByRole('separator', { name: en['resizer.sidebar'] })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: en['resizer.noteList'] })).toBeInTheDocument();
  });

  it('renders in Korean when the locale is Korean', async () => {
    const { ko } = await import('@/i18n/ko');

    render(
      <I18nProvider locale="ko">
        <AppShell />
      </I18nProvider>,
    );

    expect(screen.getByRole('region', { name: ko['pane.sidebar'] })).toBeInTheDocument();
    expect(screen.getByText(ko['noteList.empty.title'])).toBeInTheDocument();
  });
});
