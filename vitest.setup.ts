import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

import { Blob as NodeBlob } from 'node:buffer';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * What `matchMedia` reports before a test says otherwise. Desktop, so the
 * default is the layout the app has always had and a test opting into a phone
 * has to say so explicitly.
 */
const DEFAULT_TEST_VIEWPORT_WIDTH = 1280;

/**
 * The parts of a `MediaQueryList` this stub implements, spelled out here
 * rather than borrowed from `lib.dom`.
 *
 * `tsconfig.node.json` sets `lib: ["ES2023"]` and `types: ["node"]` with no
 * DOM — deliberately, so Node globals and browser globals cannot leak into
 * each other (CLAUDE.md: `vitest.setup.ts` lives in the `node` project for
 * exactly this reason). Naming `MediaQueryList` here would be a `tsc` error,
 * and adding the DOM lib to this project to silence it would erase the
 * boundary.
 */
interface MediaQueryListStub {
  readonly matches: boolean;
  media: string;
  onchange: null;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  addListener: (handler: () => void) => void;
  removeListener: (handler: () => void) => void;
  dispatchEvent: () => boolean;
}

declare global {
  var __setViewportWidth: (width: number) => void;
  var __setPointerCoarse: (coarse: boolean) => void;
  var matchMedia: (query: string) => MediaQueryListStub;
}

// jsdom's `Blob` isn't recognized by Node's built-in `structuredClone`, which
// fake-indexeddb uses to clone values on insertion — a jsdom Blob round-trips
// through IndexedDB as an empty plain object. Swap in Node's own `Blob` (which
// `structuredClone` does understand) so blob storage behaves correctly in tests.
//
// Caveat: Node's Blob returns cross-realm ArrayBuffers, so `instanceof
// ArrayBuffer` and `instanceof Blob` against jsdom's globals are false under
// test while true in a real browser. Byte content round-trips exactly; only
// identity checks differ. Prefer duck-typing over instanceof in test code.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

afterEach(() => {
  cleanup();
});

/**
 * jsdom implements NO `matchMedia` whatsoever — the property is absent, so a
 * component that calls it throws `TypeError: window.matchMedia is not a
 * function`. Every test that renders the shell needs this.
 *
 * Deliberately not a `vi.fn()` returning `matches: false` for everything: that
 * would silently pin every test to the phone layout, and a desktop regression
 * would look green. This one parses the three query shapes the app writes —
 * `(min-width: Npx)`, `(pointer: coarse)` and `(hover: none)` — against state a
 * test sets with `globalThis.__setViewportWidth` and
 * `globalThis.__setPointerCoarse`, and THROWS on any other shape rather than
 * quietly answering `false` to a query it does not understand.
 *
 * The throw is the point. J2 added a hook calling `matchMedia('(pointer:
 * coarse)')`, and without it every test rendering the shell would have gone on
 * passing against a silent `false` — pinning the whole suite to the fine-pointer
 * branch and making the touch rules untestable without anyone noticing.
 */
let viewportWidth = DEFAULT_TEST_VIEWPORT_WIDTH;

/**
 * What `matchMedia` reports for `(pointer: coarse)` and `(hover: none)`.
 *
 * Defaults to a mouse, for the same reason the width defaults to desktop: a
 * test that wants a fingertip has to say so.
 *
 * ONE flag drives both queries because no real device separates them in a way
 * this app cares about. They stay separate in the SOURCE — each rule reads as
 * the reason it exists — but a stub offering two independent switches would
 * invite a test to set up hardware that does not exist.
 */
let pointerCoarse = false;

const mediaListeners = new Set<() => void>();

globalThis.__setViewportWidth = (width: number): void => {
  viewportWidth = width;
  for (const notify of [...mediaListeners]) notify();
};

globalThis.__setPointerCoarse = (coarse: boolean): void => {
  pointerCoarse = coarse;
  for (const notify of [...mediaListeners]) notify();
};

function queryMatches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min !== null) return viewportWidth >= Number(min[1]);
  if (/\(pointer:\s*coarse\)/.test(query)) return pointerCoarse;
  if (/\(hover:\s*none\)/.test(query)) return pointerCoarse;
  throw new Error(`matchMedia stub does not understand the query: ${query}`);
}

globalThis.matchMedia = (query: string): MediaQueryListStub => ({
  get matches() {
    return queryMatches(query);
  },
  media: query,
  onchange: null,
  addEventListener: (_type: string, handler: () => void) => void mediaListeners.add(handler),
  removeEventListener: (_type: string, handler: () => void) => void mediaListeners.delete(handler),
  addListener: (handler: () => void) => void mediaListeners.add(handler),
  removeListener: (handler: () => void) => void mediaListeners.delete(handler),
  dispatchEvent: () => false,
});

afterEach(() => {
  viewportWidth = DEFAULT_TEST_VIEWPORT_WIDTH;
  pointerCoarse = false;
  mediaListeners.clear();
});
