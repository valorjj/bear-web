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
  type: [
    'hljs-type',
    'hljs-attr',
    'hljs-attribute',
    'hljs-tag',
    'hljs-name',
    'hljs-selector-class',
    'class_',
  ],
} as const satisfies Record<string, readonly string[]>;

export const MAPPED_HLJS_CLASSES: ReadonlySet<string> = new Set(Object.values(ROLE_CLASSES).flat());

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
