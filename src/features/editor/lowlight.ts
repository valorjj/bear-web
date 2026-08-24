import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

/**
 * The twelve grammars, registered EAGERLY at module scope.
 *
 * Eager was ruled on 2026-08-24 (`5c04dee`) after measurement: `+23,216 B`
 * gzipped against a `278,028 B` baseline, versus `+8,602 B` lazy. The 14.6 KB
 * saving was rejected because a lazy loader's failure mode is silent — during
 * the spike its registry tree-shook to nothing and produced a build that
 * compiled, ran, and highlighted nothing at all.
 *
 * Do NOT convert these to dynamic `import()`. The static imports above are
 * what makes the cost visible to the bundle-ceiling test in
 * `scripts/bundleSize.test.ts`, and what makes a regression impossible to
 * introduce quietly.
 *
 * Named imports rather than a loop over `CODE_LANGUAGES`, deliberately: a
 * bundler cannot statically resolve `import('highlight.js/lib/languages/' + id)`,
 * so a loop would either fail to bundle or fall back to shipping every grammar
 * highlight.js has. `extensions.test.ts` asserts this list and the roster agree.
 *
 * CAVEAT: this registry's OWN `highlightAuto` guesses a language, exactly
 * like highlight.js's does -- that is what makes it correct for export
 * (`src/features/export/html.ts`), which needs `registered()` and
 * `highlight()` but never calls `highlightAuto` at all. It is WRONG for the
 * editor's own decorations: `CodeBlockLowlight`'s built-in plugin falls back
 * to `highlightAuto` whenever a fence names no language or an unregistered
 * one, and this registry's guess would silently colour a block of plain
 * prose as if it were code. `lowlightForEditor` below exists for exactly
 * that consumer -- anyone reaching this export through the `@/features/editor`
 * barrel (as `html.ts` does) should check which one they actually want.
 */
export const lowlight = createLowlight({
  bash,
  css,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
});

/**
 * The same registry, but with auto-detection disabled -- the object
 * `CodeBlockLowlight`'s decoration plugin actually reads.
 *
 * The plugin calls `highlightAuto` whenever a code block's fence names no
 * language, or one this editor does not register, and highlight.js's own
 * `highlightAuto` GUESSES a language rather than declining. That contradicts
 * `resolveLanguage` in `codeLanguages.ts`, which is explicit that an unknown
 * language "renders unhighlighted and keeps its fence text verbatim, and
 * guessing would silently rewrite the user's document" -- and it was found
 * only by typing a fenced rust block into the running app and reading the
 * DOM: no unit test exercised an unregistered or absent language before this,
 * so a plain block of prose fenced with an unknown language, or no language
 * at all, was silently coloured as if it were code.
 *
 * `highlight` (for a genuinely registered language), `registered` and
 * `listLanguages` are untouched -- only the guessing fallback is starved, by
 * handing back the code as one unclassified text node, which yields zero
 * decorations.
 */
export const lowlightForEditor: typeof lowlight = {
  ...lowlight,
  highlightAuto: (value: string) =>
    ({
      type: 'root',
      children: [{ type: 'text', value }],
    }) as ReturnType<typeof lowlight.highlightAuto>,
};
