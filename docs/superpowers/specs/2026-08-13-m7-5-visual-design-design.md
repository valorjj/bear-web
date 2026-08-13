# M7.5 — Visual Design Pass

**Status:** approved
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Predecessor:** M5.5 (design language), M7 (search)

## Goal

Make the app look finished. M5.5 built the design *system* — colour tokens,
contrast ratios, focus rings, typefaces, motion durations. Nothing was ever
built on top of it, so the app still renders as a wireframe: no icons anywhere,
no shape language, no depth, and a note list whose only visual signal is a
divider line.

## Why now

Compared side by side against Bear, the gaps are not subtle:

| | Bear | bear-web today |
| --- | --- | --- |
| Icons | every sidebar row, every toolbar control | **none** |
| Bottom toolbar | icons | the literal characters `H ☑ • 1. B I S` |
| Shape | rounded panels, depth | square, flat |
| Tag tree | disclosure chevron, indentation, `#` glyph | text and a number |
| Note list | pin icon, date grouping, thumbnails | a divider |
| Accent | one hue running through links, checkboxes, selection | red, used only for selection |
| Body column | measured | runs the full width of the window |

## Rulings

### The accent stays out of headings

`--bear-accent` and `--bear-danger` hold the same value (`#cf3b2c` / `#ff6f5e`).
They are separate tokens so a future theme can diverge, but today they are one
colour. Spreading it across headings the way Bear spreads its teal would make
red mean "heading" and "delete forever" simultaneously, and a page of red
headings reads as a warning notice rather than a document.

So: **headings keep `--bear-text` and earn their hierarchy from size and
weight alone.** The accent is reserved for things the user can act on or has
acted on — links, checkboxes, highlight, selection, focus — plus the tag pills
that arrive in M7.6.

This is a narrower use of colour than Bear's, and it is deliberate. Restraint
is cheaper to get right than a second hue.

### Panels become cards on a canvas

A browser tab cannot have Bear's rounded, shadowed macOS window. The
equivalent inside the viewport is to give the three panes their own shape:
a darker ground behind them, and each pane floating on it as a rounded card.

This needs one new token, `--bear-canvas` — the ground. Starting values, to be
tuned against measured contrast during implementation:

```
Paper:  --bear-canvas: #e8e4de;   /* darker than --bear-sidebar #f1efec */
Ink:    --bear-canvas: #121211;   /* darker than --bear-bg #1a1a19 */
```

**A new token must be added in three places**, not two: `:root`,
`:root[data-theme='dark']`, and the `prefers-color-scheme: dark` block.
`scripts/sourceLint.test.ts` compares the two dark blocks token-for-token, and
a token present in one and missing from the other is correct for a user who
picked dark and wrong for a user whose OS is dark — invisible to every other
test.

**Cards carry depth, not borders.** `--bear-shadow-popover` is already
provisioned and unused. A hard border against the canvas would compete with the
1px dividers already used inside each pane; separating panes by depth and
separating rows by line keeps the two jobs visually distinct.

### The resizer becomes the gap

With cards, the space between panes *is* the resizer. Today it is a 1px line
with a ±3px hit target, and `e2e/smoke.spec.ts` pins that hit target
explicitly.

That test will fail, and **it will be reporting a real specification change,
not a stale expectation.** Rewriting it is correct here — but only because the
resizer's contract is deliberately changing. The rule that a failing role-based
or geometry test during a restyle is a behaviour report, not a nuisance, still
holds everywhere else in this milestone.

The new contract: the gap is the hit target, it is at least as large as the old
one, and the accent hairline on focus survives. `Resizer.tsx` is one of exactly
two files allowed to suppress the focus outline, and its allowlist entry
requires a `group-focus-visible:` marker proving it supplies its own indicator.
That marker must survive the redesign.

### Icons come from `lucide-react`

One icon set, one size, one stroke width, all from tokens. Mixed weights are
the single most legible signal of an unfinished interface.

Icons render `currentColor`, so they inherit the token-driven text colour and
introduce no colour literals.

Concrete assignments (verify the export names against the installed version —
lucide renames icons between releases):

| Where | Icon |
| --- | --- |
| Notes / Untagged / Todo / Today / Pinned / Locked / Trash | `FileText` `Inbox` `ListTodo` `Calendar` `Pin` `Lock` `Trash2` |
| Tag row / disclosure | `Hash` / `ChevronRight` (rotates when open) |
| Note row pin | `Pin` / `PinOff` |
| New note | `SquarePen` |
| Search field | `Search`, `X` |
| Bottom toolbar | `Heading` `ListTodo` `List` `ListOrdered` `Bold` `Italic` `Strikethrough` `Highlighter` `Link` `Code` `Quote` |
| Top controls | `Bold` `Italic` `Info` |

### Destructive controls keep their words

"New note" becomes an icon button, as it is in Bear. "Move to trash",
"Restore", "Delete forever" and "Empty trash" **stay as text buttons.** An
icon-only delete asks the user to recall a glyph before doing something
irreversible against a database with no server copy, and this app already
guards those actions with a confirmation dialog that focuses Cancel — the same
reasoning applies one step earlier.

This is a deliberate divergence from Bear, which hides destructive actions in
menus rather than making them icons.

### Every icon is `aria-hidden`; every icon-only control carries a label

**This is the milestone's largest risk.** Replacing text with icons is the
standard way to silently destroy a screen-reader experience, and this project
has shipped that defect class twice already — `SidebarRow` losing a space so a
row announced as `"work3"`, and `NoteListItem` concatenating three spans into
`"Groceries14:32milk"`. Both were invisible to every test that existed at the
time.

So: every icon element gets `aria-hidden="true"`, every control whose visible
content becomes an icon carries an `aria-label` sourced from `useT`, and the
resulting accessible name is pinned by a test. A control that loses its name
must fail a test, not a review.

### The body column gets a measure

`--bear-line-width: 56em` has sat in `tokens.css` unused since M5.5. On a wide
window the editor's text currently runs the full pane width, which is the
single strongest "this is a web page, not an app" signal in the product.

Wire it. The prose column is centred and capped; the *pane* still fills the
window, so the editor background and toolbars are unaffected.

## Scope

**In:** the canvas and card treatment; the resizer redesign; icons everywhere
listed above; sidebar, tag-tree and note-list density and rhythm; tag-tree
depth indentation; the body measure; editor prose refinement within the
accent ruling above.

**Out, with reasons:**

- **Tag pills — M7.6.** Rendering `#work/urgent` as a pill inside the editor is
  not a CSS problem. It needs a ProseMirror decoration plugin, and the ranges it
  decorates must agree with `parseTags`' grammar — which lives in the data
  layer, operates on Markdown text rather than a ProseMirror document, and
  masks code spans and fenced blocks by rules that do not map onto marks and
  node types. Two implementations of one grammar is precisely this project's
  defect class, so the two must share a scanner and be tested against each
  other. That is a milestone, not a task.
- **Theme switching and typography sliders — M8.** M8 owns `data-theme` and the
  `--bear-font-size` family. This pass must leave that seam intact: do not
  simplify the `:root:not([data-theme='light'])` selector, and do not hardcode
  a size that a slider is meant to drive.
- **Note-list thumbnails and date grouping.** Bear has both. Neither is needed
  to stop the app reading as a wireframe.

## Testing

`e2e/appearance.spec.ts` is the only test in this project that can observe
"renders wrong" — the round-trip suite drives `MarkdownManager` with no DOM,
and the component tests assert document structure rather than computed style.
It grows here.

Every new assertion is **relative**, never a pinned pixel value, because M8's
typography sliders move every absolute size by design. Pinning them would turn
M8 into a test-editing exercise, which is the failure mode M5.5 already hit
once.

New assertions:

1. Each pane's background differs from the canvas behind it — proof the card
   treatment reaches a rendered pixel rather than existing only in a class name.
2. Every smart-list row contains an `<svg>`.
3. Every bottom-toolbar control contains an `<svg>` and no visible text node.
4. On a wide viewport the prose column is narrower than its pane.
5. The resizer's hit target is at least as wide as it was before the redesign.

Plus, in the component suites: the accessible name of every control whose
content became an icon.

**Each assertion is adopted only after being verified by fault injection** —
introduce the defect it guards, watch precisely that test fail, restore. An
assertion that cannot be made to fail does not go in the file. All five of the
existing tests in that spec were adopted under this rule and it is what makes
the file worth having.

## Risks

**Accessible names.** Covered above; it is the reason the icon rule is stated
as a rule rather than a preference.

**Contrast on the new canvas.** No test in this project can measure contrast
over an alpha-composited overlay — jsdom has no cascade, and the existing
ratios were measured by hand and recorded in `docs/design/DESIGN-bear-web.md`.
The canvas is a new background that `--bear-faint` (counts, timestamps) and
`--bear-border` will sit against. Measure them by hand and record them there,
the way M5.5 did. `--bear-faint` was darkened once already to clear WCAG 3.0
and must not be lightened for aesthetics.

**Scope creep into M8.** A visual pass invites tuning font sizes. Anything
bound to `--bear-font-size` and its siblings belongs to M8's sliders; touching
values here means M8 re-does the work.
