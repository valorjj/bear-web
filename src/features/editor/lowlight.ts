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
