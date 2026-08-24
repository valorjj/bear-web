import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES, languageLabel, resolveLanguage } from './codeLanguages';

describe('the roster', () => {
  it('holds exactly the twelve ruled languages', () => {
    expect(CODE_LANGUAGES.map((l) => l.id).sort()).toEqual([
      'bash',
      'css',
      'java',
      'javascript',
      'json',
      'kotlin',
      'markdown',
      'python',
      'sql',
      'typescript',
      'xml',
      'yaml',
    ]);
  });

  it('gives every language a non-empty display label', () => {
    for (const language of CODE_LANGUAGES) {
      expect(language.label.length, `${language.id} has no label`).toBeGreaterThan(0);
    }
  });

  it('never lets two languages claim the same alias', () => {
    const seen = new Map<string, string>();
    for (const language of CODE_LANGUAGES) {
      for (const alias of [language.id, ...language.aliases]) {
        expect(seen.has(alias), `${alias} claimed by ${seen.get(alias)} and ${language.id}`).toBe(
          false,
        );
        seen.set(alias, language.id);
      }
    }
  });
});

describe('resolveLanguage', () => {
  it('resolves an id to itself', () => {
    expect(resolveLanguage('python')?.id).toBe('python');
  });

  it('resolves an alias to its language', () => {
    expect(resolveLanguage('ts')?.id).toBe('typescript');
    expect(resolveLanguage('py')?.id).toBe('python');
    expect(resolveLanguage('sh')?.id).toBe('bash');
  });

  it('is case-insensitive, because a fence is user input', () => {
    expect(resolveLanguage('TS')?.id).toBe('typescript');
    expect(resolveLanguage('YAML')?.id).toBe('yaml');
  });

  it('returns null for a language outside the roster', () => {
    expect(resolveLanguage('rust')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });
});

describe('languageLabel', () => {
  it('labels a known fence with its display name, not the fence text', () => {
    expect(languageLabel('ts')).toBe('TypeScript');
  });

  it('echoes an unknown fence back verbatim rather than dropping it', () => {
    // A language we do not highlight is still a language the user wrote. The
    // control must show it, so the user can see the editor is not silently
    // discarding their fence.
    expect(languageLabel('rust')).toBe('rust');
  });

  it('is null when the fence names nothing, so the caller supplies i18n copy', () => {
    expect(languageLabel('')).toBeNull();
    expect(languageLabel(null)).toBeNull();
  });
});
