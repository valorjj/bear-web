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
    // Keys whose two bundles are legitimately identical. Everything else being
    // identical would mean someone pasted the English bundle.
    //
    // - `app.name` is a proper noun.
    // - `export.html` and `export.pdf` are acronyms that Korean uses verbatim;
    //   `HTML` is not written `에이치티엠엘`. `export.markdown` is NOT here,
    //   because Korean does render that as 마크다운 — so the list stays a list of
    //   deliberate exceptions rather than a blanket exemption for the group.
    // - Every `theme.*` key is a THEME NAME, and a name is not translated. Half
    //   the roster is a borrowed proper noun (Nord, Dracula, Solarized, Gruvbox,
    //   Tokyo Night, Latte) whose transliteration — 노르드, 드라큘라 — names
    //   nothing a reader can look up, and a picker that mixed 그루브박스 라이트
    //   with Nord would be worse than one that mixes neither. The descriptive
    //   ones (Paper, Ink, Snow, Sepia, High Contrast) go with them so the group
    //   stays internally consistent; splitting it by etymology is a judgement
    //   nobody can apply again later without re-deciding it.
    const ALLOWED_IDENTICAL = [
      'app.name',
      'export.html',
      'export.pdf',
      ...Object.keys(en).filter((key) => key.startsWith('theme.')),
    ];

    const identical = Object.keys(en).filter(
      (key) => ko[key as keyof typeof ko] === en[key as keyof typeof en],
    );

    expect(identical.sort()).toEqual([...ALLOWED_IDENTICAL].sort());
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

  it('keeps document.documentElement.lang in sync with the active locale', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="ko">
        <Probe />
      </I18nProvider>,
    );

    expect(document.documentElement.lang).toBe('ko');

    await user.click(screen.getByRole('button', { name: 'toggle' }));

    expect(document.documentElement.lang).toBe('en');
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

  it('matches the primary subtag exactly, not merely a prefix', () => {
    // 'kok' (Kokni) starts with "ko" but is not Korean; 'english' is not a
    // real BCP-47 tag but starts with "en" and must not match either.
    expect(detectLocale(['kok'])).toBe('en');
    expect(detectLocale(['english'])).toBe('en');
  });

  it('still recognises Korean regardless of region or case', () => {
    expect(detectLocale(['ko'])).toBe('ko');
    expect(detectLocale(['ko-KR'])).toBe('ko');
    expect(detectLocale(['KO-kr'])).toBe('ko');
  });
});
