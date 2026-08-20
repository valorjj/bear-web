# bear-web

A local-first, web-based notes application modeled on the Bear macOS app.
Notes are Markdown, organized by inline hashtags rather than folders, and
stored entirely in the browser. There is no backend and no account.

## Development

```bash
npm install
npm run dev
```

## Scripts

| Script              | Purpose                              |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start the dev server                 |
| `npm run build`     | Produce the static bundle in `dist/` |
| `npm run preview`   | Serve the built bundle               |
| `npm test`          | Unit and component tests             |
| `npm run test:e2e`  | End-to-end tests                     |
| `npm run lint`      | oxlint (this project has no ESLint)  |
| `npm run typecheck` | TypeScript, no emit                  |
| `npm run format`    | Prettier                             |
| `npm run shots`     | Design reference screenshots         |
| `npm run measure`   | Measured geometry and typography     |

The first five are the gate: all of them pass before any commit.

`npm run shots` and `npm run measure` are not tests — they assert nothing and are
excluded from `npm run test:e2e`. They exist because nothing in the test suite can
see "renders wrong": `shots` writes a fixed set of framings to
`docs/design/shots/`, and `measure` writes the app's real geometry and typography
to `docs/design/measurements.md`, so a visual change can be checked against a
number and a picture instead of by eye.

## Features

Three panes — tag sidebar, note list, editor. Markdown notes with inline
hashtags, nested tags, seven smart lists, full-text search, trash with restore,
and light and dark themes following the system preference.

The editor is Tiptap over a Markdown round-trip: headings, lists, task lists,
tables, code blocks, blockquotes, links, highlight and inline marks. Any
construct the schema has no node for is preserved verbatim rather than dropped.

A note can be exported as Markdown, HTML or PDF. The HTML is self-contained —
no stylesheet link, no font host, no script — and PDF goes through the browser's
own print pipeline, so text stays selectable and the fonts are the real ones.

## Documentation

- Project rules and hard-won constraints: `CLAUDE.md`
- Design language and the measured comparison against Bear:
  `docs/design/DESIGN-bear-web.md`
- Design spec: `docs/superpowers/specs/2026-08-06-bear-web-design.md`
- Implementation plans: `docs/superpowers/plans/`

## Notice

This project reproduces Bear's interaction design as a learning exercise. It
does not include any Bear-owned fonts, illustrations, icons, or theme
palettes, and it is not affiliated with or endorsed by Shiny Frog.
