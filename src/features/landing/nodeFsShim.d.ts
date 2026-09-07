/**
 * The minimal shape `harnessDefaults.test.ts` needs from `node:fs`.
 *
 * `tsconfig.app.json` (the project that owns everything under `src/`, this
 * test file included) deliberately has no `"node"` in its `types` array —
 * CLAUDE.md requires a `process.env` reference under `src/` to fail
 * typecheck, and adding full Node types here would defeat that. Declaring
 * only `readFileSync`, rather than pulling in `@types/node`, is the same move
 * `server/pdf/mermaid.ts` makes for the opposite reason: that file describes
 * a browser API from a project with no DOM lib; this one describes a Node API
 * from a project with no Node types. Real types for `node:fs` live only in
 * the `node` and `server` tsconfig projects.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}
