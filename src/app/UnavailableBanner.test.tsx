import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '@/i18n';
import { en } from '@/i18n/en';

import { DatabaseStatusProvider } from './DatabaseStatusContext';
import { UnavailableBanner } from './UnavailableBanner';

function renderBanner(status: 'ready' | 'memory') {
  return render(
    <I18nProvider locale="en">
      <DatabaseStatusProvider status={status}>
        <UnavailableBanner />
      </DatabaseStatusProvider>
    </I18nProvider>,
  );
}

describe('UnavailableBanner', () => {
  it('renders nothing when the database is ready', () => {
    const { container } = renderBanner('ready');

    expect(container).toBeEmptyDOMElement();
  });

  it('warns when running in memory', () => {
    renderBanner('memory');

    expect(screen.getByText(en['database.memory.title'])).toBeInTheDocument();
    expect(screen.getByText(en['database.memory.body'])).toBeInTheDocument();
  });

  it('announces itself to assistive technology', () => {
    renderBanner('memory');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(en['database.memory.title']);
  });

  it('cannot be dismissed', () => {
    renderBanner('memory');

    // The warning is permanent for the session — data really is not being saved,
    // and a dismissed banner would let a user forget that.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('throws when used outside a status provider', () => {
    expect(() =>
      render(
        <I18nProvider locale="en">
          <UnavailableBanner />
        </I18nProvider>,
      ),
    ).toThrow(/DatabaseStatusProvider/);
  });
});
