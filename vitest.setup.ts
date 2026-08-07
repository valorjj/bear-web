/// <reference types="node" />
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

import { Blob as NodeBlob } from 'node:buffer';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom's `Blob` isn't recognized by Node's built-in `structuredClone`, which
// fake-indexeddb uses to clone values on insertion — a jsdom Blob round-trips
// through IndexedDB as an empty plain object. Swap in Node's own `Blob` (which
// `structuredClone` does understand) so blob storage behaves correctly in tests.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

afterEach(() => {
  cleanup();
});
