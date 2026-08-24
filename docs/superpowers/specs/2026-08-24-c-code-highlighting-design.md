# C — Code block language and syntax highlighting

Sub-project **C** from `docs/superpowers/NEXT.md`. Queued after F because it
needs the theme system F built.

Code blocks are plain text today. Nothing in the repo imports `lowlight`,
`highlight.js`, or any language UI. What exists already — and it matters,
because it is the half of C that does not need building — is the fence
language itself: `` ```ts `` parses into a `codeBlock` node carrying
`language: 'ts'`, survives autosave, and serializes back unchanged.
`src/features/editor/markdown.test.ts:97` and `stability.test.ts:72` both pin
it.

So C is four things: highlighting, a way to choose the language, syntax
colours across sixteen themes, and export fidelity.

## Decisions inherited, not re-derived

Four were settled before this spec and must not be silently reopened.

- **Grammars ship EAGER**, ruled 2026-08-24 (`5c04dee`). Measured: `+23,216 B`
  gzipped against a `278,028 B` baseline, versus `+8,602 B` lazy. The earlier
  lazy choice was made against labels of "~5 KB" and "60–90 KB", both guesses
  and both wrong. Lazy was rejected because the 14.6 KB saving buys an async
  registry whose loader **tree-shook to nothing during the spike and silently
  produced a build containing no languages at all** — a build that succeeds,
  runs, and highlights nothing. Re-open only if the roster grows past twelve.
- **Twelve languages**: bash, css, java, javascript, json, kotlin, markdown,
  python, sql, typescript, xml, yaml. The set the spike measured.
- **The UI is a picker control on the block**, not fence autocomplete.
  Autocomplete would need a ProseMirror suggestion plugin — no prior art
  anywhere in `src/`, and it fires inside a context where every keystroke is
  meant to be literal. Deferred, not dropped.
- **Syntax colours are a shared light/dark pair with per-theme override**, not
  a palette per theme. Twelve baseline values instead of ninety-six.
  Per-theme overrides for the five code-scheme themes are a named follow-up —
  with one exception forced by measurement, below.

## 1. The engine

`lowlight` plus `@tiptap/extension-code-block-lowlight`, **pinned to
`3.29.2`**. Unpinned, `npm i` fails `ERESOLVE` against `@tiptap/core@3.29.2`.
`highlight.js` arrives transitively via `lowlight`, so one install brings
both.

Registering it means **`StarterKit.configure({ codeBlock: false })`**.
`extensions.ts:41` currently configures only `underline: false`, and line 30
already records that as load-bearing rather than tidying — the same hazard
applies here. If both `StarterKit`'s `codeBlock` and `CodeBlockLowlight`
register, Tiptap's reversed extension order means one silently wins, and the
failure mode is a working editor with no highlighting and no error. This is
the third instance of that shape in C's history (the lazy loader, the dead
derivation in F, this), so it gets an explicit test rather than a comment:
**the registered `codeBlock` node must be the lowlight one**, asserted on the
extension list, not inferred from a rendered colour.

Grammars are registered at module scope, eagerly, in one place — a single
`CODE_LANGUAGES` array that is the only list of languages in the codebase.
The picker's options, the lowlight registrations, and the alias table all read
from it. Two lists that must agree is the defect `sourceLint` exists to
prevent.

## 2. The palette

### Six roles, and why six is enough

`--bear-code-keyword`, `-string`, `-number`, `-comment`, `-function`,
`-type`.

Operators, punctuation, delimiters and plain identifiers get **no token and
inherit `--bear-text`**. That is what keeps the count at six: the roles above
are the ones that carry meaning at a glance, and colouring punctuation is what
makes a code block look like confetti.

### The class mapping is the risk, not the colours

highlight.js emits on the order of twenty `.hljs-*` classes across these
twelve grammars, and **an unmapped class renders as plain text with no
error** — indistinguishable from "this token type isn't interesting". The
mapping therefore gets a test that does not trust this document: it
highlights a fixture per language, collects every class the twelve grammars
actually emit, and fails on any class that is neither mapped to a role nor
explicitly listed as deliberately inheriting `text`. The roster is derived
empirically, the way `RawBlock`'s token set was.

The expected grouping, as a starting point rather than an assertion:
`keyword`/`literal`/`built_in` → keyword; `string`/`regexp`/`char.escape` →
string; `number` → number; `comment`/`quote` → comment;
`title`/`title.function_`/`section` → function;
`type`/`attr`/`attribute`/`tag`/`name` → type.

### The light/dark mechanism, and a new use of `--bear-dark`

Twelve literal values — six light, six dark — live in `:root`, and the six
tokens interpolate between them on the theme's own `--bear-dark`:

```
--bear-code-keyword: color-mix(
  in oklab,
  var(--bear-code-keyword-l) calc((1 - var(--bear-dark)) * 100%),
  var(--bear-code-keyword-d)
);
```

**This is a new kind of use for `--bear-dark`**, which until now has only
scaled alphas inside `calc()`. Interpolating two colours on it is consistent
with F's "one scalar per theme, not five" ruling and avoids the grouped
selector F explicitly rejected — but it is unproven, and F's own derivation
was **dead on first implementation while every test passed**. So it is
verified the way F's was, with a probe: a scratch theme declaring
`--bear-dark: 0.5` must resolve every one of the six to a value between the
two literals. If that fails, the fallback is six overrides in each of the
seven dark theme blocks, which is uglier and still correct.

Reading these back with `getPropertyValue` will return the literal
`color-mix(...)` string, not a colour. Every consumer goes through
`e2e/fixtures/tokens.ts`, which paints onto a probe element. This is already
a ruling; C adds six more tokens that depend on it.

### Contrast

Syntax colours are body-size text on `--bear-surface`, the `pre` background.
Five of the six are held to **4.5:1** on `surface`, matching `text`, `muted`,
`accent` and `danger`.

**`comment` is held to 3.0**, and the justification is borrowed rather than
invented: `contrast.spec.ts:39` already relaxes `faint` to 3.0 because it
carries counts and timestamps — secondary information a reader skims. A
comment is the same category, and 4.5:1 forbids a dim comment, which is the
universal convention. This is a deliberate, argued exception, not a lowered
bar of convenience. **Do not relax any of the other five to keep a palette
faithful**; F's ruling on that stands.

### `high-contrast` needs an override in this round

Not a follow-up. `[data-theme='high-contrast']` sets `bg` and `surface` to
`#000000` and `text` to `#ffffff`. A generic dark syntax palette will not
clear 4.5:1 against pure black for most saturated hues, and this theme exists
for readers who need the contrast. It therefore ships with its own six values
in C, chosen to clear the floor on black, and it is the one exception to
"overrides are a follow-up". Expect its palette to be closer to the
`accent`/`text` family than to a conventional syntax scheme, and say so in the
block's comment.

## 3. The picker

A `Decoration.widget` anchored to the code block, following
`src/features/editor/TableControls.ts` — 193 lines, and its docblock already
records why a widget rather than React chrome positioned off a rect: a widget
lives **inside** the scrolling content, so it tracks the block with no
geometry code at all.

E measured that buttons inside a table-bar widget **focus normally**, unlike
B1's heading-fold gutter, where Chromium refuses `.focus()` to every
descendant. So this control needs no keyboard escape hatch of its own —
which was `Mod-Alt-F`'s whole reason for existing in B1. That measurement is
pinned by `e2e/editorAffordances.spec.ts` and is the reason this design is
cheap.

The control shows the current language's display name, or a neutral label
when the fence names none. Activating it opens a filterable list of the
twelve. Start with a popover in the widget; reach for `src/ui/Dialog.tsx`
only if focus management fights back, and record which happened.

### Aliases: stored and displayed are different things

If the user wrote `` ```ts ``, the picker displays "TypeScript" and the
document keeps `ts`. **Selecting the same language the fence already names
must not rewrite the fence.** Normalizing `ts` → `typescript` would silently
edit the user's file on the next autosave, which is exactly the class of thing
`docs/rulings/notes-lifecycle.md` exists to prevent. The alias table maps many
fence strings to one grammar and one display name; it never maps backwards.

An unknown language — `` ```rust `` while rust is outside the roster —
renders unhighlighted, keeps its fence text verbatim, and shows "rust" in the
control. Never rewritten, never dropped, never silently replaced with the
nearest match.

### Strings: language names are data, the chrome is i18n

The project rule is that no user-facing string is hardcoded in a component;
everything goes through `useT`, `en.ts` defines the key type, and `ko.ts` is
annotated `Record<TranslationKey, string>` so a missing translation is a
compile error.

**The twelve language display names are exempt, deliberately, because they are
proper nouns.** "TypeScript", "Kotlin" and "YAML" are spelled identically in
both locales, and routing them through the translation table would mean
twenty-four entries that must never diverge — two lists that must agree, which
is the defect the rule exists to prevent, reintroduced in the name of
following it. They live as a `label` field on `CODE_LANGUAGES` alongside the
grammar and the aliases.

**Everything else is i18n'd**: the control's accessible name, the label shown
when the fence names no language, the filter field's placeholder, and the
empty-result text when a filter matches nothing. Those are UI copy and get
keys in both locales.

### Accessibility

The control is a popover trigger, so it carries `aria-haspopup` and
`aria-expanded` — `src/ui/Button.tsx` already exposes `ariaHasPopup` and
`ariaExpanded` props for exactly this, and `docs/rulings/accessibility.md`
governs them. The accessible name must say *what* it does, not just name the
current language: a control reading only "TypeScript" tells a screen-reader
user nothing about it being a language selector.

The list is keyboard-navigable and dismissible on Escape with focus returning
to the trigger. `ScopeMenu.tsx` is the precedent for the roles; `Dialog.tsx`
is the precedent for focus return, and it exists because `ConfirmDialog` had a
focus-trap gap that `859aa5b` closed.

## 4. Export

`EXPORT_TOKEN_NAMES` in `src/features/export/html.ts` gains the six tokens,
and the export stylesheet gains the `.hljs-*` rules. Export reads the live
cascade at export time, so an exported document already carries whatever theme
the user is looking at; the six join that for free. PDF goes through the same
stylesheet, so it needs nothing of its own.

One hazard specific to this file: **the whole export stylesheet is a single
template literal, and a backtick inside a CSS comment terminates it.** The
failure message points at the prose, not the backtick, and ten unrelated test
files fail to load at once because the module is imported widely. Do not write
`` `code` `` in a comment added to that stylesheet.

## 5. What must not regress

- **The fence language round-trip.** `` ```ts `` → `ts` in the document →
  `` ```ts `` out. `markdown.test.ts:97` and `stability.test.ts:72` are the
  canaries; neither may be weakened to accommodate a new node type.
- **`RawBlock`'s token set.** `codeBlock` is already handled, so swapping the
  node should be inert here. "Should be" is not evidence — verify by
  injection, not by reading.
- **A tag inside a fence is not a tag.** `tagAgreement.test.ts:77` covers
  `` ```\n#work\n``` ``. Highlighting must not make `#work` inside a code
  block into a tag pill, and the highlighter now produces spans inside that
  block where before there was bare text.
- **The `code` mark is not the `codeBlock` node.** `.ProseMirror code` styles
  inline code and `.ProseMirror pre code` deliberately undoes it inside a
  block (`editor.css:293`). Six new colours must not leak into inline code.

## 6. Testing

- **Unit**: the class-to-role mapping derived empirically per language; the
  alias table in both directions, including that selecting the current
  language is a no-op on the document; the `CODE_LANGUAGES` single-source-of-
  truth agreement; that the registered `codeBlock` is the lowlight one.
- **Contrast**: the six tokens × sixteen themes in `e2e/contrast.spec.ts`,
  `comment` at 3.0 and the rest at 4.5 on `surface`. This is the gate that
  decides whether the baseline palette ships as designed or adjusted.
- **Shots**: a code-heavy note joins `e2e/fixtures/corpus.ts`. That makes the
  roster 13 shots × 16 themes; count the files rather than trusting the exit
  code, per the standing warning about the theme-list regex.
- **Bundle**: an assertion on the gzipped main-bundle size with a stated
  ceiling. C is the one sub-project that can make the app worse at its own
  stated goal — "lightweight, fast" — so `+23.2 KB` becomes a number a test
  owns rather than a number someone remembers. A test that must be edited to
  raise the ceiling is the point.
- **Editor tests** need the three jsdom stubs (`Range.getBoundingClientRect`,
  `Range.getClientRects`, `document.elementFromPoint`) documented in
  `NoteEditor.test.tsx`'s header, plus `EditorView.scrollToSelection` for a
  block toggle. Missing stubs throw **uncaught**, so `vitest run` exits 1 even
  when every assertion passes: check exit codes, not pass counts.
- **Accessible names and roles** on the control and its list, per
  `docs/rulings/accessibility.md`. The name assertion is the one that catches a
  control reading "TypeScript" and nothing else.
- **`ko.ts` completeness** is enforced by the compiler, not by a test — its
  `Record<TranslationKey, string>` annotation must not be weakened to get a
  build green. Add the translation instead.

## 7. Out of scope, named rather than dropped

- **Per-theme syntax overrides** for Nord, Dracula, Solarized ×2, Gruvbox ×2
  and Tokyo Night. Decided by looking at `npm run shots` afterwards, not by
  guessing now. (`high-contrast` is not in this list — see §2.)
- **Fence autocomplete.** The interaction C deliberately did not build.
- **Languages beyond the twelve.** Growing the roster re-opens the eager
  ruling, because per-language cost is not uniform: CSS is 4,324 B gzipped,
  JSON is 431 B.
- **A custom-theme editor**, still open from F.
- **Copy-to-clipboard on a code block.** Obvious neighbour, not asked for.

## 8. Known limits

- **Sixteen themes × six roles is ninety-six contrast pairs to keep green**,
  even though only twelve values are authored. The baseline either clears every
  theme's floor or it gets adjusted until it does; there is no third outcome.
- **The `--bear-dark` colour interpolation is unproven** and is the one part of
  this design that could fail outright. §2 names the fallback.
- **A derived token shows as `color(srgb …)` in DevTools**, so a syntax colour
  cannot be eyeballed against a published palette hex without converting.
  Already true of every derived token since F; six more join.
- **`lowlight` is a runtime dependency in the main bundle now.** Its own
  size, not just the grammars', is inside the measured `+23.2 KB` — the
  ceiling test owns the total, so a future `lowlight` upgrade that grows will
  surface as a failing test rather than as a slower app.
