/**
 * A language the editor can highlight, its display name, and every fence
 * string that means it.
 *
 * `label` is DATA, not a translation key, and that is deliberate. These are
 * proper nouns — "TypeScript" and "YAML" are spelled identically in English
 * and Korean — so routing them through `en.ts`/`ko.ts` would create
 * twenty-four entries that must never diverge. Two lists that must agree is
 * the defect the no-hardcoded-strings rule exists to prevent, and it would be
 * reintroduced here in the name of obeying it. The picker's own chrome (its
 * accessible name, its filter placeholder, its no-language label) IS
 * translated; see `editor.code.*` in `src/i18n/en.ts`.
 */
export interface CodeLanguage {
  /** The canonical fence string, and lowlight's registration name. */
  id: string;
  /** Shown in the picker. A proper noun; see the docblock above. */
  label: string;
  /** Other fence strings that mean this language. Never includes `id`. */
  aliases: readonly string[];
}

/**
 * The twelve languages, ruled on 2026-08-24 and measured at `+23.2 KB` gzipped
 * when registered eagerly.
 *
 * This array is the ONLY list of languages in the codebase. `lowlight`'s
 * registrations, the picker's options and the alias table all read from it,
 * because two lists that must agree is exactly the defect
 * `scripts/sourceLint.test.ts` exists to catch elsewhere.
 *
 * Growing this list re-opens the eager-versus-lazy ruling rather than
 * inheriting it: per-language cost is not uniform. CSS is 4,324 B gzipped and
 * JSON is 431 B, an order of magnitude apart.
 *
 * Aliases are the ones highlight.js itself recognises, narrowed to the
 * unambiguous ones. `md` is deliberately absent from `markdown`: it is a
 * common fence string, but it is also this project's own file extension and
 * the ambiguity is not worth the convenience.
 */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  { id: 'css', label: 'CSS', aliases: [] },
  { id: 'java', label: 'Java', aliases: [] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'markdown', label: 'Markdown', aliases: [] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'sql', label: 'SQL', aliases: [] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'xml', label: 'XML', aliases: ['html', 'svg', 'xhtml'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
];

const BY_ALIAS: ReadonlyMap<string, CodeLanguage> = new Map(
  CODE_LANGUAGES.flatMap((language) =>
    [language.id, ...language.aliases].map((alias) => [alias, language] as const),
  ),
);

/**
 * The language a fence string names, or `null` if it names none this editor
 * knows.
 *
 * Case-insensitive because a fence is user input and `TS` is not a mistake.
 * Returning `null` rather than a nearest match is load-bearing: an unknown
 * language renders unhighlighted and keeps its fence text verbatim, and
 * guessing would silently rewrite the user's document.
 */
export function resolveLanguage(fence: string | null | undefined): CodeLanguage | null {
  if (!fence) return null;
  return BY_ALIAS.get(fence.trim().toLowerCase()) ?? null;
}

/**
 * What the picker's trigger should read for a given fence.
 *
 * Three cases, deliberately distinct: a known language shows its proper
 * display name; an UNKNOWN language echoes what the user typed, so the editor
 * visibly is not discarding it; and an absent language returns `null` so the
 * caller can supply a translated "no language" label rather than this module
 * inventing English copy.
 */
export function languageLabel(fence: string | null | undefined): string | null {
  if (!fence || fence.trim() === '') return null;
  return resolveLanguage(fence)?.label ?? fence.trim();
}
