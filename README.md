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
| `npm run lint`      | ESLint                               |
| `npm run typecheck` | TypeScript, no emit                  |
| `npm run format`    | Prettier                             |

## Documentation

- Design spec: `docs/superpowers/specs/2026-08-06-bear-web-design.md`
- Implementation plans: `docs/superpowers/plans/`

## Notice

This project reproduces Bear's interaction design as a learning exercise. It
does not include any Bear-owned fonts, illustrations, icons, or theme
palettes, and it is not affiliated with or endorsed by Shiny Frog.
