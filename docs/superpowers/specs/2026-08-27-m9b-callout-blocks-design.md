# M9b — Callout blocks

**Date:** 2026-08-27
**Status:** approved, ready for planning
**Supersedes:** the one-line "M9b | Callout blocks (schema node, tokenizer,
serializer, export)" row in `docs/superpowers/specs/2026-08-19-m9a-visual-system-design.md`

---

## 1. Why

Two reasons, and the second one is a live bug.

**A note has no way to say "this part matters."** Bold and highlight are
inline; a blockquote is untinted and says only "someone else said this". The
reference app ships panel blocks (measured in `DESIGN-bear-web.md`: full-measure
width, tinted fill, a 6pt accent bar down the left edge, ~6 radius), Obsidian
ships admonitions, GitHub renders alerts natively. This app has nothing.

**`> [!NOTE]` is silently corrupted today.** Probed against the real pipeline
on 2026-08-27:

```
IN :  > [!warning] Be careful
OUT:  > \[!warning\] Be careful
```

The serializer escapes the `[`, so **opening and saving a note that contains a
GitHub alert or an Obsidian callout rewrites it**. Nothing in the suite catches
this. It is the same class as the `!\[x\](url)` escaping already recorded in
CLAUDE.md, and it is a corruption bug independent of whether callouts ever
ship.

## 2. Decisions taken before design

Settled with the user on 2026-08-27, recorded so the plan does not relitigate
them:

| Decision | Chosen | Rejected |
| --- | --- | --- |
| Syntax | `> [!type] Title` — the callout microsyntax | ` ```ad-type ` fenced blocks |
| Roster | Fixed: five types | User-defined types; Obsidian's full ~14 |
| Collapsible | **No.** B1's "no blockquote folding" stands | Collapse in Markdown (`-`/`+`); collapse in `noteFolds` |
| Creation | The existing Quote button gains a chevron | A new toolbar slot; right-click only |
| Schema | An attribute on `blockquote` | A separate `callout` node; decoration-only |

**Why the microsyntax and not the fenced form.** A ` ```ad-warning ` block
degrades, in every reader that does not know it, to a **code block full of the
user's prose**. `> [!warning]` degrades to a blockquote — still readable, still
prose — and GitHub and Obsidian core both render it natively with no plugin.
K1 made "an exported folder is a portable Markdown bundle" a property of this
app; a callout that degrades to a monospace box would quietly undo it.

**Why an attribute and not a node.** A callout *is* a blockquote — that is what
the Markdown says. As an attribute, the toolbar button, `Mod+Shift+B`, nesting,
`EditorContextMenu` and `editorState`'s `blockquote` flag all keep working
untouched, and switching type is `updateAttributes` rather than a
content-preserving migration. The schema's corruption modes are documented at
length in CLAUDE.md; this is the option that touches it least.

**Why not collapsible.** `2026-08-20-b1-collapsible-headings-design.md` rules
"no list folding, no blockquote folding, no code-block folding". Reopened
deliberately and upheld: a callout long enough to want folding usually wanted
to be a section under a heading. This removes fold persistence, the chevron,
the `-`/`+` Markdown flag, and an a11y surface from the milestone.

## 3. The Markdown contract

**Irreversible.** Like `files/<id>.webp`, this goes into note text and cannot
change later without rewriting every note that has a callout.

### 3.1 The written form

Always emitted in the **loose** form — a blank `>` line between title and body:

```markdown
> [!warning] 백업 전에 확인
>
> 이 작업은 되돌릴 수 없습니다.
```

An untitled callout omits the title and everything after the marker:

```markdown
> [!tip]
>
> 제목이 없으면 아이콘만 보입니다.
```

### 3.2 Read leniently, write canonically

Both spacings parse, and they parse **differently** — verified against the real
pipeline, not assumed:

| Source | Parses to |
| --- | --- |
| `> [!warning] T`<br>`> Body.` (tight) | ONE paragraph, text `"[!warning] T\nBody."` |
| `> [!warning] T`<br>`>`<br>`> Body.` (loose) | TWO paragraphs: `"[!warning] T"`, `"Body."` |

Obsidian and GitHub both write the tight form. The tokenizer therefore accepts
both and the serializer always writes the loose one.

### 3.3 Canonical type spellings

`info` `tip` `success` `warning` `danger` — lowercase, five words, nothing
else. Matching is case-insensitive and aliases normalize on save, so a note
pasted from Obsidian or GitHub becomes ours without losing meaning:

| Accepted on read | Written back as |
| --- | --- |
| `note` `info` `abstract` `summary` | `info` |
| `tip` `hint` `important` | `tip` |
| `success` `check` `done` | `success` |
| `warning` `caution` `attention` | `warning` |
| `danger` `error` `failure` `bug` | `danger` |

### 3.4 An unrecognised marker is never a colour and never lost

`> [!사내공지] 제목` stays a **plain blockquote**, and the blockquote carries the
raw marker in a `rawMarker` attribute so it serializes back **verbatim**.

Inventing a hue from an unknown word would be worse than today's loss.
*Dropping* the text is not on the table. And leaving it as ordinary prose is
not an option either — it would hit the very escaping bug §1 exists to fix.
One attribute is the cost of losing nothing.

## 4. The document shape

```
blockquote  { callout: CalloutType | null, rawMarker: string | null }
  content: calloutTitle? block+
    calloutTitle   content: inline*
    paragraph …    the body
```

- `blockquote` is swapped out of StarterKit (`blockquote: false`) and
  re-registered extended — the pattern `codeBlock: false` +
  `CodeBlockLowlight` already uses in `extensions.ts`.
- **`calloutTitle` is `defining`**, so pasting into the body cannot absorb it
  and Enter at its end drops into the body rather than splitting the header.
- **An empty title is a real empty node, not an absent one.** `> [!warning]`
  with no title still gets a `calloutTitle`. Serialization omits the title text
  when that node is empty; §5 covers what is shown in its place.
- `callout` and `rawMarker` are mutually exclusive: a recognised marker sets
  the first, an unrecognised one the second, and a plain blockquote has
  neither.

### 4.1 `sanitize` gains a repair

A `calloutTitle` anywhere but as the first child of a blockquote is **unwrapped
to a paragraph**.

This is the highest-risk item in the milestone and is proven by fault injection
**before** anything is built on it. A node in an invalid position is precisely
the "invalid document, editor silently refuses to be typed into" failure
CLAUDE.md records from the image-in-an-empty-paragraph bug — which shipped for
a day. `markdown.ts`'s `sanitize` already repairs one such class
(`contentMatch.fillBefore`); this is a second.

## 5. The type name is a placeholder, not content

`renderNoteBody` builds its schema from `getSchema(editorExtensions)` — the
**default** extension list, with no i18n options threaded through. Verified,
not assumed. So an untitled callout's name cannot come from `useT` in export.

**Resolution:** the editor shows a muted localized hint (`경고`) in the empty
header, because it has i18n. Export shows **the icon alone**. A placeholder is
a hint to the writer, not part of the note, so its absence from an export is
correct rather than a gap.

Both alternatives are rejected explicitly:

- **Baking the name into the Markdown at serialize time** would make note text
  depend on the UI language at the moment of the last save.
- **A CSS `content:` string per locale** would put user-facing Korean outside
  `useT`, where `ko.ts`'s `Record<TranslationKey, string>` completeness check
  cannot see it. That check is the only thing standing between us and a missing
  translation, and it must not be routed around.

Translated names reach the extension through `buildEditorExtensions` options,
the way `foldHint` already reaches `HeadingFold` — never by importing `@/i18n`
into `src/features/editor/`.

## 6. Colour

Five types × **two roles**. One role is not enough: the **fill** is a
translucent tint that `--bear-text` must read through, and the **edge** — the
left bar and the icon — is opaque and must be visible on its own.

```css
--bear-cal-hue-info: …;                      /* one global hue per type */
--bear-cal-a: calc(… var(--bear-dark) …);    /* alpha, exactly like --bear-hl-a */
--bear-cal-fill-info: color-mix(in srgb, var(--bear-cal-hue-info) calc(var(--bear-cal-a) * 100%), transparent);
--bear-cal-edge-info: var(--bear-cal-hue-info);
```

This is `--bear-hl-*`'s pattern verbatim: derived globally from one hue set and
an alpha keyed on `--bear-dark`, with **per-theme overrides only where a theme
demands one**. It is why this does not cost sixteen hand-authored blocks.

**The hues stay independent of `--bear-accent` and `--bear-danger`.** Reusing
`--bear-danger` for the danger callout was considered and rejected: those are
UI-chrome tokens, and a theme that shifts its accent must not repaint the
user's prose.

### 6.1 Contrast is the real work of this section

`e2e/contrast.spec.ts` gains ten rows — five fills as `OVERLAYS` at 4.5:1 under
`text`, five edges as `PAIRS` at 3.0:1 as decorative marks. That is **160
checks across the roster.** Real failures are expected in High Contrast,
Gruvbox and Solarized, and per-theme overrides are expected to follow.

This test is what keeps a callout readable rather than merely looking right in
Indigo Light, and no unit test can substitute for it.

## 7. Icons

**CSS `mask-image` with an inline `data:` SVG over `background: currentColor`.**
No JavaScript, no `lucide-react`, no `ICON_NODES` entry — and identical in the
editor and in exported HTML.

This corrects the first cost estimate, which assumed each glyph needed a
verbatim `__iconNode` copy in `Icon.tsx` because importing `lucide-react`
elsewhere was measured at +57.20 kB gzip and rejected. That constraint is real;
it simply does not apply to a glyph drawn from a stylesheet.

**The declarations are mirrored in `src/styles/editor.css` and the export
stylesheet in `src/features/export/html.ts`, and a test asserts the two
agree.** Mirrored CSS drifting silently is this repo's most-repeated failure
shape — `KNOWN_FLATTENED_COLLISIONS` already has to be mirrored the same way.

## 8. Export

- New tokens join `EXPORT_TOKEN_NAMES`, each with a `FALLBACKS` entry. Per the
  highlight precedent, the fills degrade to one system colour in a reader with
  no custom properties: the hue is lost, the icon and the structure survive.
- **Markdown export** carries the syntax verbatim, which already works.
- **PDF is free** — the server renders the document the client built. Confirmed
  by `npm run shots:pdf`, not assumed.

## 9. Creation and editing

The existing Quote button gains a chevron, exactly the pattern the Highlight
button already uses (`BottomToolbar`'s colour chevron → `HighlightMenu`):

- Click **Quote** → plain blockquote, unchanged behaviour.
- Click the **chevron** → a menu of six `menuitemradio` rows: 인용 (plain) plus
  the five types. The menu both creates a callout and switches an existing
  one's type, including back to a plain quote.
- An input rule converts `> [!warning] ` typed at the start of a line, for
  users who know the syntax. It ships **alongside** the menu, never instead of
  it.

Accessibility follows `docs/rulings/accessibility.md`: the chevron carries
`aria-haspopup` and `aria-expanded`, the rows are `menuitemradio` with
`aria-checked` reflecting the active type, and the callout renders with a
label naming its type so the colour is never the only carrier of meaning.

## 10. Order of work

**The escaping fix ships first, on its own.** It is a live corruption bug and
must not wait behind five hues. Everything after it is additive.

1. The tokenizer claims `[!type]`; `> [!NOTE]` round-trips. Round-trip fixture.
2. Schema: `blockquote` attributes, `calloutTitle`, `sanitize` repair —
   with the fault injection of §4.1 before anything builds on it.
3. Serializer: loose form out, both forms in, aliases normalized.
4. Tokens and the sixteen-theme contrast pass.
5. Editor rendering: fill, edge, icon, placeholder.
6. Toolbar chevron, menu, input rule, i18n.
7. Export stylesheet, mirror test, `EXPORT_TOKEN_NAMES`.
8. `deriveSnippet` strips the marker and keeps the title.
9. e2e, `npm run shots` corpus note, rulings, CLAUDE.md.

## 11. Out of scope

- **User-defined types**, custom icon packs, and the plugin's `color:`,
  `icon:` and `metadata:` options. A colour in note text would violate "every
  colour comes from a CSS custom property", which is a rule this app enforces
  in `sourceLint`.
- **Collapsing** — §2.
- **Nested callout styling.** A callout inside a callout is valid (blockquotes
  nest) and gets no special treatment.
- **Search masking.** `search.ts` matches the raw marker today, so searching
  `warning` hits every warning callout. Accepted and written down rather than
  fixed: masking is `maskedBlockText`'s job and a bigger change than the
  benefit.

## 12. What no test can catch

Recorded here because roughly a third of this repo's rulings are enforced by
nothing:

- **A hue that is legible but wrong.** Contrast proves readability, never that
  `warning` reads as caution rather than as decoration.
- **The mirrored icon declarations agreeing in syntax but not in rendering** —
  the mirror test compares the two stylesheets, not two rasterisations.
- **An alias table that silently normalizes a distinction the user meant.**
  `failure` and `danger` both become `danger`; someone who wanted them
  different has no way to say so, by design.
