# M7.6 — Tag Pills

**Status:** approved
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Predecessors:** M5 (tags), M7 (search), M7.5 (visual design)

## Goal

Make a tag look like a tag while you are writing it.

## Why

Tags are this app's whole organising idea — there are no folders — and the
editor renders `#work/urgent` in exactly the same ink as the prose around it.
A user typing `#안녕` gets a working tag (it appears in the sidebar, it filters,
it counts) with no visual acknowledgement whatsoever, and has no way to tell it
apart from a heading, which `# 안녕` — one space different — actually is.

This was deferred at M5 as "M5b", and M5b was never scheduled. The gap is not
cosmetic: it hides the product's central mechanism.

## Rulings

### One scanner, two views

`parseTags` already computes the position of every tag it finds — `open` and
`end` are local variables in its scan loop — and discards them, returning only
normalized names.

So this milestone does not write a second parser. It extracts what the scanner
already knows:

```ts
export interface TagRange {
  /** The normalized tag name, as `parseTags` would return it. */
  tag: string;
  /** Index of the opening `#` in the input. */
  start: number;
  /** Index one past the tag's last character. */
  end: number;
}

export function findTagRanges(markdown: string): TagRange[];

export function parseTags(markdown: string): string[] {
  return [...new Set(findTagRanges(markdown).map((r) => r.tag))];
}
```

The grammar exists in one place. A second implementation of it — which is what
a naive "highlight things that look like tags" plugin would be — is this
project's signature defect class, and the extraction removes the opportunity
rather than documenting a rule against it.

**This must be pinned by a test, not asserted in prose.** Every case in the
existing `parseTags` suite runs through both paths and the names must match.
While that test is green, a divergent second implementation cannot exist.

### The plugin masks by node type, not by backticks

`parseTags` masks code by looking for backticks, because it reads Markdown. A
ProseMirror document has no backticks: inline code is a `code` mark and a
fenced block is a `codeBlock` node.

So the plugin assembles each textblock's string itself, replacing any
`code`-marked run with ``\u0000`` of equal length — the same mask character
`parseTags` uses, chosen there precisely because it terminates a tag without
permitting one to start. `codeBlock` nodes are skipped whole.

The masking *convention* is shared; only the way the mask is derived differs.
That difference is inherent — one side reads Markdown, the other reads a
document — and it is the one place where the two representations genuinely
must be handled separately.

**Assembly is per block, not per text node.** A tag may only open at a `#`
preceded by start-of-line or whitespace, so the scanner needs the preceding
character. Splitting at text-node boundaries destroys that context: a `#` at
the start of a text node that follows a bold run would look like start-of-line
and open a tag that `parseTags` would not.

**Known limit:** a tag split across an inline mark boundary — `#wo` in bold,
`rk` plain — is not decorated. `parseTags` still finds it in the Markdown, so
the tag works; only the pill is missing. Accepted; a user who does that is not
trying to write a tag.

### Decorations, never a mark

The pill is a `Decoration.inline`. The document is not modified.

That is the whole reason this is safe: no schema change, no serializer change,
no round-trip risk, and no possibility of a tag pill surviving into a note's
Markdown. Tags are derived from text, and the text stays plain.

### The pill lifts while the cursor is inside it

A tag whose range intersects the current selection is not decorated. Without
this, typing `#w`, `#wo`, `#wor` re-pills on every keystroke and the character
widths jump under the cursor. The pill appears when the cursor leaves.

### `#` stays visible

The pill includes the hash. This app does not hide Markdown syntax, and the
`#` is what distinguishes a tag from the heading that `# ` — one space
different — produces. Hiding it would remove the very cue the user needs.

### Appearance

Accent-coloured text on a faint accent-tinted fill, `--bear-radius-sm`.
Consistent with M7.5's ruling that the accent marks things the user can act on
or has acted on, and that headings keep `--bear-text`.

## Scope

**In:** the `findTagRanges` extraction, the decoration plugin, cursor
suppression, the pill's styling, and tests.

**Out:**

- **Clicking a pill to filter by that tag — M7.7, and explicitly wanted.** This
  is Bear's behaviour and the next milestone should deliver it. It is out of
  M7.6 because the editor plugin would need to know the app's scope state, and
  the boundary that the editor knows only about its document has been kept
  clean so far. *How* to cross it — a callback threaded through
  `RichEditor`, a context, or an event the shell listens for — is that
  milestone's actual design problem, not an implementation detail to guess at
  here.
- **Tag rename and delete**, still carried from M5b.
- **Autocomplete while typing `#`.** A separate feature with its own
  interaction design.

## Testing

**Unit, on `findTagRanges`:** ranges are correct for both tag forms (simple
`#work`, multi-word `#a b#`), for tags adjacent to punctuation, and for the
grammar's rejections. Every existing `parseTags` case must agree across both
paths — that agreement test is what makes "one scanner" true.

**Structural, on the plugin.** A decoration changes neither the document nor
its Markdown, so **every round-trip test in this project is blind to whether
the plugin runs at all**. This is the same blind spot that let a dead
`==highlight==` tokenizer and a live-but-banned underline mark ship in M4, and
that hid the task-item promotion bug until M7. The plugin therefore needs
assertions on the decoration set itself: how many decorations, at which
positions, and none inside a `codeBlock` or a `code` mark.

**Suppression:** a test placing the selection inside a tag and asserting that
tag alone loses its decoration while its neighbours keep theirs.

**End to end:** one assertion in `e2e/appearance.spec.ts` that a typed tag
renders with a different colour and background from the prose beside it —
adopted only if a fault injection makes precisely it fail, per that file's
standing rule.

## Risks

**The extraction is a refactor of code that guards data integrity.**
`parseTags` decides what the tag index contains; a behaviour change there
silently reorganises a user's whole sidebar. The extraction must be
provably behaviour-preserving, which is what the agreement test establishes —
it should be written and green *before* the plugin work starts.

**Decoration recomputation cost.** The plugin re-scans on every transaction. A
note is a few kilobytes and the scanner is linear, but `parseTags` was made
quadratic once already by an unbounded look-ahead (a 900 KB line measured
2.1s). Recompute only when the document or the selection actually changed.
