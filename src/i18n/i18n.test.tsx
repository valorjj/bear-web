import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { en } from './en';
import { detectLocale, I18nProvider, useLocale, useT } from './index';
import { ko } from './ko';

function Probe() {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t('noteList.empty.title')}</span>
      <button type="button" onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}>
        toggle
      </button>
    </div>
  );
}

describe('translation bundles', () => {
  it('define exactly the same keys', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });

  it('have no empty translations', () => {
    for (const [key, value] of Object.entries(ko)) {
      expect(value, `ko.${key} is empty`).not.toBe('');
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key} is empty`).not.toBe('');
    }
  });

  it('are actually translated rather than copied from English', () => {
    // 'app.name' is a proper noun and legitimately identical; everything else
    // being identical would mean someone pasted the English bundle.
    const identical = Object.keys(en).filter(
      (key) => ko[key as keyof typeof ko] === en[key as keyof typeof en],
    );

    expect(identical).toEqual(['app.name']);
  });
});

describe('I18nProvider', () => {
  it('renders Korean by default', () => {
    render(
      <I18nProvider locale="ko">
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('title')).toHaveTextContent(ko['noteList.empty.title']);
  });

  it('renders English when asked', () => {
    render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('title')).toHaveTextContent(en['noteList.empty.title']);
  });

  it('switches locale at runtime', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="ko">
        <Probe />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'toggle' }));

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('title')).toHaveTextContent(en['noteList.empty.title']);
  });

  it('throws when useT is used outside a provider', () => {
    expect(() => render(<Probe />)).toThrow(/I18nProvider/);
  });
});

describe('detectLocale', () => {
  it('picks Korean for any Korean language tag', () => {
    expect(detectLocale(['ko'])).toBe('ko');
    expect(detectLocale(['ko-KR'])).toBe('ko');
  });

  it('picks English for anything else', () => {
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['fr'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('honours the first supported tag in order', () => {
    expect(detectLocale(['fr', 'ko-KR', 'en'])).toBe('ko');
  });
});
