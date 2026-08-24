/**
 * Which `.hljs-*` classes the six syntax roles claim, and which deliberately
 * inherit `--bear-text`.
 *
 * Both sets exist because the failure mode is silent: a class in neither set
 * renders as plain body text with no error, which looks exactly like a
 * deliberate decision. `highlightClasses.test.ts` highlights a sample per
 * language, collects every class the twelve grammars actually emit, and fails
 * on anything unaccounted for — so this file is derived from the grammars,
 * not from anyone's memory of highlight.js's documentation.
 *
 * Keep in step with `src/styles/editor.css`'s `.hljs-*` rules and with the
 * export stylesheet in `src/features/export/html.ts`.
 */
export const ROLE_CLASSES = {
  keyword: ['hljs-keyword', 'hljs-literal', 'hljs-built_in', 'hljs-selector-tag'],
  string: ['hljs-string', 'hljs-regexp', 'hljs-char', 'hljs-meta-string'],
  number: ['hljs-number', 'hljs-symbol'],
  comment: ['hljs-comment', 'hljs-quote'],
  // `function_` and `class_` are highlight.js's nested-scope classes: a
  // `title.function_`/`title.class_` node emits BOTH `hljs-title` and this
  // bare (no `hljs-` prefix) second class on the same span. They carry the
  // function/class-name meaning `hljs-title` alone does not distinguish.
  function: ['hljs-title', 'hljs-section', 'hljs-function', 'function_'],
  // `inherited__` is highlight.js's class for the parent named in an
  // `extends`/inheritance clause (`title.class.inherited`, e.g. the `B` in
  // `class A extends B`). It is a type/class reference, same as `class_` —
  // and empirically it always co-occurs with BOTH `hljs-title` and `class_`
  // on one span, which is exactly the ['hljs-title', 'class_'] conflict
  // `editor.css`'s `.hljs-title.class_` compound selector exists to resolve
  // in favour of this role.
  type: [
    'hljs-type',
    'hljs-attr',
    'hljs-attribute',
    'hljs-tag',
    'hljs-name',
    'hljs-selector-class',
    'class_',
    'inherited__',
  ],
} as const satisfies Record<string, readonly string[]>;

export const MAPPED_HLJS_CLASSES: ReadonlySet<string> = new Set(Object.values(ROLE_CLASSES).flat());

export type Role = keyof typeof ROLE_CLASSES;

const CLASS_TO_ROLE: ReadonlyMap<string, Role> = new Map(
  (Object.entries(ROLE_CLASSES) as [Role, readonly string[]][]).flatMap(([role, classes]) =>
    classes.map((cls) => [cls, role] as const),
  ),
);

/** The role a single `.hljs-*` (or unprefixed `function_`/`class_`/`inherited__`) class carries, or `null`. */
export function roleOf(cls: string): Role | null {
  return CLASS_TO_ROLE.get(cls) ?? null;
}

/**
 * The role a FLATTENED class list resolves to, mechanically rather than by
 * per-case judgement.
 *
 * `@tiptap/extension-code-block-lowlight`'s decoration plugin (`parseNodes`)
 * concatenates every ancestor scope's `className` array onto each leaf,
 * ancestor-first, so the class list arrives ANCESTOR-FIRST, INNERMOST-LAST —
 * exactly the order `ROLE_CLASSES`' consumers already emit it in (see
 * `highlightClasses.test.ts`, which reads it straight off the real decoration
 * plugin). The innermost scope is the most specific thing highlight.js said
 * about that token, and it is also exactly what export's real NESTED markup
 * gives the token (its own, most specific, element) — so "the role of the
 * last class in the list that maps to a role" is not a guess about which
 * role should win; it is what the export path already does, restated as a
 * rule so the editor's flattened case can be made to agree with it by
 * construction rather than by enumerating cases and choosing.
 *
 * Returns `null` if no class in the list maps to a role at all (a plain,
 * unclassed or `INHERITS_TEXT`-only run).
 */
export function roleOfFlattenedClasses(classes: readonly string[]): Role | null {
  let winner: Role | null = null;
  for (const cls of classes) {
    const role = roleOf(cls);
    if (role) winner = role;
  }
  return winner;
}

/**
 * Every class combination this project has found the editor's decoration
 * flattening actually produce, where the accumulated classes span more than
 * one role — and therefore every combination that needs, and has, an
 * explicit compound selector in `src/styles/editor.css` and the export
 * stylesheet in `src/features/export/html.ts`. Ordered ancestor-first,
 * innermost-last, matching how the classes are actually emitted.
 *
 * This list is NOT the source of truth for correctness — `roleOfFlattenedClasses`
 * above is, and `highlightClasses.test.ts`'s enumeration sweep checks the
 * REAL painted colour against that mechanical rule for every combination a
 * broad corpus produces, independent of whether it is listed here. This list
 * exists so a human reading this file sees the full, current set in one
 * place, and so that sweep can also assert nothing here has gone stale
 * (a listed combination the corpus no longer produces, or a produced
 * combination missing from this list) — three rounds of hand-discovery
 * (Task 4, then two review passes) each found more than the last, which is
 * why the sweep — not this list — is what a new grammar or corpus addition
 * is actually checked against.
 */
export const KNOWN_FLATTENED_COLLISIONS: readonly (readonly string[])[] = [
  ['hljs-title', 'class_'],
  ['hljs-title', 'class_', 'inherited__'],
  ['hljs-tag', 'hljs-string'],
  ['hljs-string', 'hljs-number'],
  ['hljs-function', 'hljs-keyword'],
  ['hljs-function', 'hljs-type'],
  ['hljs-function', 'hljs-number'],
  ['hljs-function', 'hljs-string'],
  ['hljs-function', 'hljs-literal'],
];
// `['hljs-title', 'inherited__']` (without `class_`) was in an earlier draft
// of this list, matching a defensive CSS selector Task 4 wrote alongside
// `.hljs-title.class_`. The mechanical sweep in `highlightClasses.test.ts`
// never produces it across all twelve grammars and the full corpus --
// `inherited__` empirically always co-occurs with BOTH `hljs-title` and
// `class_` (see the comment on `ROLE_CLASSES.type` above) -- so it was
// removed from this list. The CSS rule targeting it is left in place as a
// defensive no-op rather than deleted.

/**
 * Classes that are correct to leave at `--bear-text`.
 *
 * `hljs-punctuation` and `hljs-operator` are here on purpose: colouring
 * punctuation is what makes a code block look like confetti, and the six roles
 * exist to carry meaning at a glance rather than to paint every token.
 */
export const INHERITS_TEXT: ReadonlySet<string> = new Set([
  'hljs-punctuation',
  'hljs-operator',
  'hljs-params',
  'hljs-variable',
  'hljs-property',
  'hljs-subst',
  'language-javascript',
  'language-css',
  'language-xml',
  // Markdown's own grammar highlights **bold** text and `inline code` spans
  // as markup emphasis, not as a code token with keyword/string/etc.
  // meaning — none of the six roles fit, so both stay neutral.
  'hljs-strong',
  'hljs-code',
]);
