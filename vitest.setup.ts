import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

import { Blob as NodeBlob } from 'node:buffer';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
