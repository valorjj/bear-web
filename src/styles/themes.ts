import type { TranslationKey } from '@/i18n/en';

export type ThemeId = 'indigo-light' | 'indigo-dark' | 'paper' | 'ink' | 'high-contrast';

export interface Theme {
  id: ThemeId;
  labelKey: TranslationKey;
  /**
   * Which heading the picker files this theme under. Deliberately NOT derived
   * from the palette: `high-contrast` is a dark theme by intent, and deriving
   * the group from luminance would make the picker's grouping a side effect of
   * a colour edit.
   */
  group: 'light' | 'dark';
}

/**
 * The roster. Adding a theme is a row here plus a CSS block in `tokens.css`;
 * `scripts/sourceLint.test.ts` asserts the two agree in both directions, and
 * that every block defines all 22 themeable tokens.
 *
 * This file carries no colours. Colours live only in `tokens.css`, so a theme
 * is a name here and a cascade there — which is what keeps first paint free of
 * JavaScript.
 */
export const THEMES: readonly Theme[] = [
  { id: 'paper', labelKey: 'theme.paper', group: 'light' },
  { id: 'ink', labelKey: 'theme.ink', group: 'dark' },
];

/** Applied by `:root`, i.e. what a visitor with no stored choice sees. */
export const DEFAULT_THEME_ID: ThemeId = 'paper';

/** Applied by the `prefers-color-scheme: dark` block when no theme is chosen. */
export const SYSTEM_DARK_ID: ThemeId = 'ink';
