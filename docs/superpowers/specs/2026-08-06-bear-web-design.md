# bear-web — Design Spec

**Date:** 2026-08-06
**Status:** Approved
**Repository:** https://github.com/valorjj/bear-web.git

## Summary

A web-based notes application modeled on the Bear macOS app: a three-pane layout
(tag sidebar / note list / editor), notes written in Markdown, and organization
by inline hashtags rather than folders.

The app is local-first. All data lives in the browser's IndexedDB. There is no
backend, no account, and no login. The build is a static bundle deployed to
GitHub Pages.

### Non-goals for this spec

Sync across devices, encrypted notes, wiki-style note linking, archive, PWA
installation, and mobile layouts are Phase 2 and get their own spec.

### Intellectual property

This project reproduces Bear's interaction design and layout. It does not
reproduce Bear's assets. Fonts, illustrations, icons, and theme palettes are
open-source or original, and themes carry original names.

## Stack

| Concern         | Choice                                  | Reason                                            |
| --------------- | --------------------------------------- | ------------------------------------------------- |
| Framework       | React 19 + TypeScript                   | Largest ecosystem for the editor layer            |
| Build           | Vite                                    | Instant HMR; static output deploys anywhere       |
| Styling         | Tailwind CSS + CSS custom properties    | Themes become token maps, not stylesheets         |
| Editor          | Tiptap (ProseMirror)                    | Real document model, Markdown input rules, tables |
| Persistence     | Dexie (IndexedDB) + `dexie-react-hooks` | Live queries make the database the store          |
| UI state        | Zustand                                 | Ephemeral state only                              |
| i18n            | Korean and English from day one         | Retrofitting means touching every component       |
| Unit tests      | Vitest                                  |                                                   |
| Component tests | React Testing Library                   |                                                   |
| E2E tests       | Playwright                              |                                                   |

No SSR. Server rendering buys nothing when every byte of data is in IndexedDB.

## Architecture

```
src/
  app/          shell, layout, routing, global keybindings
  data/         dexie schema, repositories, migrations, export/import
  features/
    notes/      list, item, CRUD, title derivation, trash
    tags/       parser, tag tree, sidebar, rename/delete
    editor/     tiptap config, extensions, toolbars
    search/     index provider, command palette
    settings/   theme picker, typography panel
  themes/       theme token registry
  i18n/         ko / en resource bundles
  ui/           primitives: pane, resizer, button, popover, toast
```

Each feature folder reaches persistence only through `data/repositories` and
exports a narrow public surface from its `index.ts`. A reader should understand
what a feature does from that file without opening its internals.

IndexedDB is the single source of truth for durable data. Components subscribe
to live Dexie queries; there is no second copy of note data in application
state. Zustand holds only genuinely ephemeral UI state: focused pane, open
modals, current sidebar selection. Pane widths are a deliberate exception —
they live in the settings table, not Zustand, because a pane width should
survive a reload like any other durable preference.

## Data model

```ts
notes:    id (uuid, pk), title, text, createdAt, updatedAt,
          pinned, trashedAt | null, archivedAt | null
noteTags: [noteId + tag] (compound pk)
tags:     tag (pk), collapsed, iconKey, sortOrder
files:    id (uuid, pk), noteId, blob, mime
settings: key (pk), value
```

`notes.text` holds Markdown and is the canonical content.

`notes.archivedAt` is reserved for Phase 2. It exists in the schema so that
adding archive later does not require a migration, and it stays `null`
throughout Phase 1.

### Derived title

`notes.title` is a denormalized cache of the first non-empty line of `text`,
stripped of leading `#` characters and trimmed. It is recomputed on every save.
It exists for list rendering and sorting performance only. Deriving it again
from `text` must always produce the same result.

### Derived tags

`noteTags` is an index rebuilt from note text on every save, not user-assigned
data. Dropping the table and rebuilding it from `notes.text` must always be
safe, and a repository function exposes exactly that operation.

The `tags` table stores only user metadata about a tag (collapsed state, icon,
sort order). It never determines which notes carry a tag.

### Forward compatibility

Notes carry a UUID and `updatedAt` despite there being no server. This is the
difference between adding sync later and rewriting the data layer later.

## Tag system

A pure function is the core of the feature:

```ts
parseTags(markdown: string): string[]
```

It recognizes three forms:

- Simple: `#tag`
- Multi-word, delimited by a closing hash: `#project plan#`
- Nested, split on slashes: `#work/workflow`

It must not match `#` inside fenced code blocks, inline code spans, or URLs.

The sidebar renders parsed tags as a collapsible tree by splitting each tag on
`/`. A parent node appears whenever any child exists, whether or not the parent
itself is used on a note.

**Rename** rewrites the tag token across every note containing it, within one
Dexie transaction, and rewrites nested descendants along with it.

**Delete** strips the tag token from note bodies; the notes themselves survive.
It requires confirmation and captures a snapshot of affected note text so the
operation can be undone.

## Smart lists

Pure predicates over a note, collected in one module:

| Sidebar row          | Predicate                                   |
| -------------------- | ------------------------------------------- |
| 태그 없음 / Untagged | note has no parsed tags                     |
| 해야 할 일 / Todo    | body contains an unchecked `- [ ]`          |
| 오늘 / Today         | `updatedAt` falls on the current local date |
| 고정됨 / Pinned      | `pinned === true`                           |
| 휴지통 / Trash       | `trashedAt !== null`                        |

All rows except Trash exclude trashed notes.

**잠긴 항목 / Locked** renders its sidebar row in Phase 1 and always shows an
empty state. Real encryption requires WebCrypto, passphrase UX, and a recovery
story, and belongs in Phase 2.

## Editor

Tiptap over ProseMirror, with Markdown as the persisted format. On document
change, debounced at 300ms, the document serializes to Markdown and writes to
Dexie. The write is force-flushed on blur, `visibilitychange`, and
`beforeunload`.

### Round-trip guarantee

Markdown serialization is the highest-risk component in the project: drift
corrupts notes silently and without recovery. A table-driven test suite asserts
that `markdown → document → markdown` is idempotent for every supported
construct, and it is written before the extensions it covers.

Covered constructs: headings, bold, italic, underline, strikethrough,
highlight, inline code, fenced code blocks with language, task lists, nested
ordered and unordered lists, blockquotes, links, tables, images, horizontal
rules, and tags.

### Custom extensions

- **Tag mark** — renders `#tag` as a styled, clickable pill that filters the
  note list; serializes back to plain `#tag` text.
- **Code block** — lowlight syntax highlighting with a language selector.
- **Table** — insert, add and remove rows and columns.
- **Image** — pasted and dropped images are stored as blobs in the `files`
  table and referenced by id. Images are never inlined as base64, which would
  bloat the Markdown.

### Editor UI

- Floating bottom toolbar: heading, checkbox, list, bold, italic, highlight,
  link, table, image, overflow menu.
- Top-right controls: bold/italic/underline, an info panel showing word count,
  character count, created date, and modified date, and an overflow menu.
- Fold chevrons on headings that collapse the section beneath them.

### Failure handling

A serialization exception must never overwrite the last known-good Markdown.
The editor keeps the in-memory document, surfaces an error toast, and leaves
the stored text untouched.

## Search

Client-side, behind a `SearchProvider` interface. The initial implementation
scans note bodies directly, which is fast enough for several thousand notes. If
it becomes slow, the provider is replaced without touching callers.

Korean determines the indexing strategy. Most JavaScript search libraries
tokenize on whitespace, which makes Korean search nearly useless. Indexing uses
substring and bigram matching instead. This is an architectural decision, not a
tuning parameter.

The command palette, bound to Cmd/Ctrl+K, offers: open note, new note, jump to
tag, switch theme, and toggle sidebar.

## Theming and typography

Themes are data. A registry maps each theme id to a set of design tokens,
applied as CSS custom properties on `:root[data-theme="..."]`. Adding a theme
means adding an object, never a stylesheet.

Both a light and a dark set ship in Phase 1, with names original to this
project. Theme selection defaults to `prefers-color-scheme` and accepts a
manual override persisted in settings.

Typography preferences write directly to CSS custom properties: `--font-size`,
`--line-height`, `--line-width`, `--para-spacing`, `--para-indent`, plus
separate body, heading, and code font selections. Sliders bind straight to
variables, so adjusting them does not re-render the editor.

Fonts are Pretendard for UI and body text and JetBrains Mono for code. The
choice is driven by Korean rendering quality, which most Latin-first families
handle poorly.

## Error handling and data safety

- **IndexedDB unavailable** (private browsing): fall back to an in-memory
  store and show a persistent banner stating that notes will not be saved.
- **Quota exceeded** on image paste: catch the error, show a toast, and leave
  the note intact.
- **Deletion** is always trash-first. Emptying the trash requires confirmation.
- **Export and import** of the full database as JSON ships in M1. It is the
  user's backup and the project's debugging escape hatch.

## Testing

| Layer      | Tool                  | Coverage                                                                                        |
| ---------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| Logic      | Vitest                | Tag parser, smart-list predicates, Markdown round-trip, title derivation, tag rename and delete |
| Components | React Testing Library | Sidebar tree, note list, toolbars, settings panels                                              |
| End-to-end | Playwright            | Four critical flows                                                                             |

Test-driven development is mandatory for the tag parser and the Markdown
serializer, and optional elsewhere.

The four Playwright flows, which must never break:

1. Create a note, type, reload the page, and find the content intact.
2. Type a tag and see it appear in the sidebar tree.
3. Search for text and find the matching note.
4. Change the theme, reload, and find it persisted.

## Milestones

| ID  | Milestone   | Definition of done                                                                                                  |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| M0  | Scaffold    | Vite, TypeScript, Tailwind, ESLint, Prettier, Vitest, Playwright, GitHub Actions CI, and a live GitHub Pages deploy |
| M1  | Data layer  | Dexie schema, repositories, migrations, JSON export and import, unit tests. No UI.                                  |
| M2  | Shell       | Resizable three-pane layout, i18n wiring, base light theme, empty states                                            |
| M3  | Notes       | Create, delete, trash, restore, title derivation, sorting, using a plain `textarea` editor                          |
| M4  | Editor      | `textarea` replaced by Tiptap, round-trip suite green, both toolbars                                                |
| M5  | Tags        | Parser, tag pills, sidebar tree, nested tags, rename and delete                                                     |
| M6  | Smart lists | Every row in the smart-list table, the Locked row in its permanent empty state, and trash management                |
| M7  | Search      | Search provider, results UI, command palette                                                                        |
| M8  | Preferences | Theme registry, theme picker, typography panel                                                                      |
| M9  | Polish      | Keyboard shortcuts, empty-state illustrations, export to Markdown, HTML, and print                                  |

M3 deliberately ships a plain `textarea`. It proves the full persistence loop —
create, type, save, reload, restore — before editor complexity can obscure a
data-layer bug. M0 through M3 produce a working, deployed notes application;
M4 through M9 make it Bear.

## Risks

1. **Markdown round-trip drift.** The test suite is the mitigation, but this
   remains the failure mode with the worst consequences.
2. **Phase 1 spans four features.** M0 through M3 is roughly a third of the
   total effort. If the schedule slips, M7 and M8 are the natural cuts.
3. **Syntax visibility.** Bear displays Markdown syntax and its styling at the
   same time; Tiptap hides syntax by default. Matching this requires custom
   ProseMirror decorations, and the outcome may be close rather than identical.

## Phase 2

Locked notes, cross-device sync, wiki-style `[[note]]` links, archive,
PWA and offline installation, and mobile responsive layouts. Each gets its own
spec.
