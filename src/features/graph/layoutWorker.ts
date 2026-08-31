import type { Graph } from './buildGraph';
import { layoutGraph } from './layoutGraph';

/**
 * Typed by hand rather than with `/// <reference lib="webworker" />`.
 *
 * `tsconfig.app.json` sets `lib: ["ES2023", "DOM"]`, and pulling in the
 * WebWorker lib alongside DOM redeclares a pile of globals. The same reasoning
 * put a hand-written `MediaQueryList` shape in `vitest.setup.ts`: declare the
 * narrow surface actually used, rather than importing a conflicting world.
 */
const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Graph>) => void): void;
};

ctx.addEventListener('message', (event) => {
  // A Map is structured-cloneable, but an array of entries survives every
  // transport and is what `runLayout` reassembles.
  ctx.postMessage([...layoutGraph(event.data)]);
});
