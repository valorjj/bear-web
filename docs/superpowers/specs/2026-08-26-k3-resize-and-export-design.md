# K3 — Resize, and images in every export

**Status:** specced, not started. 2026-08-26.
**Parent:** K (Image storage), the last of the four. K1 and K2 shipped the same
day.

## Why this exists

An image can be pasted (K1) and travels between devices (K2), but it is stuck
at column width and it vanishes from every export. Exporting a note with a
screenshot currently produces:

| Format | Today |
| --- | --- |
| Markdown | `![](files/<id>.webp)` pointing at nothing |
| HTML | the same reference, so a broken image |
| PDF | the same, rendered by a container that cannot fetch it even in principle |

## Decisions already taken

Settled in conversation on 2026-08-26.

| Decision | Choice |
| --- | --- |
| Display width | **In the Markdown**, `![alt\|640](files/<id>.webp)` |
| HTML and PDF | **Inline** the bytes as `data:` URIs |
| Markdown | **A `.zip`** holding the `.md` and a `files/` folder |
| Zip | **Store-only, hand-written.** No dependency |

## Goal

Set how large an image displays, and get it out of the app in every format.

**Done means:** drag an image narrower and it stays that way across a reload
and on another device; export the note as HTML or PDF and the image is in the
file; export as Markdown and get a zip that opens in Obsidian with the image
intact.

## Non-goals

- Cropping, rotation, alt-text editing, or any other image editing.
- A resize handle on remote-URL images. They still render as monospace source
  (K1's privacy rule) and have nothing to resize.
- Changing what is STORED. The stored WebP stays 2048px at q80; the width is a
  display instruction, not a re-encode.

## The width in the Markdown

**`![alt|640](files/<id>.webp)`** — the pipe-width convention Obsidian uses.

Chosen over a `displayWidth` column because the size then travels with the
note: sync carries it, export carries it, and another device shows the same
layout with no extra plumbing. It is also per-USE rather than per-image, so
the same screenshot can be full width in one note and a thumbnail in another.

**The cost, stated plainly:** it is not standard Markdown. A strict reader
shows `alt|640` as the alt text. That is a visible wart in exactly one place —
someone else's Markdown viewer — and it buys correct behaviour everywhere
inside this app and in Obsidian, which is the reader that actually matters for
a bundle this app produces.

**Parsing rules, which must be exact:**

- `![alt|640](files/x.webp)` → alt `alt`, width `640`.
- `![|640](files/x.webp)` → no alt, width `640`.
- `![a|b](files/x.webp)` → alt `a|b`, NO width. A non-numeric suffix is part
  of the alt text, not a malformed width, because that is what every other
  reader will show.
- `![alt|640](https://example.com/a.png)` → still a `RawImage`. The width
  syntax does not make a remote URL renderable.
- Width is clamped to 1..2048 on parse. A note edited by hand can carry
  anything, and a `width: 0` or `width: 999999` image is a broken layout the
  user cannot see the cause of.

**Serialization emits the pipe ONLY when a width is set**, so an image never
resized round-trips byte-identically to what K1 wrote. The `CANONICAL`
fixtures get both shapes.

## The resize affordance

A drag handle on the image's right edge, shown on hover or focus, mirroring
the table handles' behaviour — and **like them, it is pointer-only**, so it
needs a keyboard route of its own.

- **Pointer:** drag the right edge. The width follows the pointer, clamped to
  1..2048 and to the column's own width.
- **Keyboard:** the image is a selectable atom already; with it selected,
  `Mod-Alt-Left` / `Mod-Alt-Right` step the width by 10%, and `Mod-Alt-0`
  resets to full column. Named after `Mod-Alt-F`'s precedent, which exists for
  exactly this reason — `docs/rulings/accessibility.md` records that a
  pointer-only affordance for a real capability is a regression.
- The width is written on pointer-UP, not on every move. A width per mouse
  event would put a hundred transactions and a hundred sync-dirty marks
  through `notes.save` for one drag.

**jsdom cannot test the drag** — no `setPointerCapture`, no layout — so the
pointer path belongs in Playwright and the keyboard path in unit tests. That
split is a standing rule here, not a shortcut.

## Export

### HTML

`renderNoteHtml` already inlines the theme's tokens. It gains image inlining:
every `<img src="files/…">` becomes a `data:image/webp;base64,…`.

**`html.ts` must not import from `src/data/`.** It is passed the blobs it
needs, resolved by the caller — the same shape `readExportTokens` already
follows by taking the document rather than reaching for it.

### PDF

The renderer's browser **cannot resolve any host** — that is sub-project G's
isolation, and K3 must not weaken it. So the PDF path inlines exactly as HTML
does, and the renderer needs nothing it cannot already reach.

> **Corrected 2026-08-27.** This read "the renderer container has deliberately
> no route off the host", which is G's **control 4** — and control 4 is NOT
> implemented. G's own spec carries a NOT IMPLEMENTED caveat under it; this
> spec cited the control without the caveat, and so did
> `docs/rulings/export.md`'s images bullet. What is built is
> `--host-resolver-rules=MAP * ~NOTFOUND` at browser launch; the container
> keeps a real route to the internet. K3's conclusion is unchanged — the
> renderer still cannot fetch an image — but it rests on the browser-level
> block, not on the container's network.

**This forces a limit change, and it is the one risk worth naming.**
`MAX_EXPORT_BYTES` is 2 MiB. A single 600 KB WebP is ~800 KB base64, so a note
with three screenshots exceeds it today. The cap rises to **20 MiB**, which
covers a note with a dozen images and still bounds what a client can push into
memory on a Mac Mini in someone's house.

Raising a cap is a decision, not a detail: the number is sized against the
image quota's own arithmetic (2048px q80 lands 200–600 KB, so 20 MiB is ~25
images) rather than picked round.

### Markdown

A **`.zip`**, store-only:

```
note-title.zip
├── note-title.md      ← the text, verbatim, with files/<id>.webp intact
└── files/
    └── <id>.webp
```

This is what K1's relative-path decision was for. The bundle opens in Obsidian
with the images resolving, and in any editor the paths are at least honest.

**Store-only and hand-written, no dependency.** WebP is already compressed, so
deflate would spend CPU to save nothing; a STORE-method zip is a local file
header, the bytes, a central directory and an end-of-central-directory
record. The only fiddly part is CRC-32, which is a 20-line table.

**A note with no images still exports a plain `.md`**, not a zip with one file
in it. The zip exists to carry images; producing one for a note that has none
would make every export worse to serve one case.

## Testing

**Unit.** The pipe-width parser, every rule above including the non-numeric
case and the clamp. The zip writer: a known input produces bytes a real
unzipper accepts — asserted by reading the central directory back, not by
eyeballing a hex dump. Round-trip fixtures for both image shapes.

**Component.** The keyboard resize path: select the image, press the chord,
assert the width attribute and the serialized Markdown.

**e2e.** The drag, because jsdom cannot: drag the handle, assert the rendered
width changed and survived a reload. Export each of the three formats from a
note with an image and assert the bytes are in the file — for the zip, that
means unzipping it in the test and finding the WebP.

**The PDF one matters most and is the one that can lie.** A text extraction
cannot see a missing image any more than it can see tofu. `npm run shots:pdf`
rasterises page 1, and the assertion has to be on PIXELS — a non-uniform
region where the image should be — not on the document's text.

## Risks

- **`MAX_EXPORT_BYTES` at 20 MiB is a bigger buffer on a home server.** It is
  still bounded, still behind a session, and still rate-limited, but it is
  twenty times what it was.
- **A hand-written zip that is subtly wrong opens nowhere.** Mitigated by
  testing against a real unzipper rather than against our own reader.
- **The pipe syntax leaks into other people's viewers.** Accepted above, and
  the reason the width is omitted entirely when unset.
- **Drag on a phone.** A drag handle at the right edge of an image is a small
  target on a touch screen, and this ships after J2a's 44px rule. The handle
  gets the same treatment or the keyboard route carries it.

## What K3 does NOT change

The stored bytes, the capture path, the sync protocol, the privacy rule for
remote URLs, and the renderer's isolation.
