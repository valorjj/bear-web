# K1 — Image capture and display: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste or drop a screenshot into a note and see it — stored in IndexedDB, referenced as `![](files/<id>.webp)`, working entirely offline on one device.

**Architecture:** A browser-side downscaler produces one WebP per image; `files.add` stores it; the editor inserts a relative Markdown path; a new `StoredImage` Tiptap node with a NodeView resolves that path to a reference-counted object URL. `RawImage` keeps handling every other destination, so remote URLs still render as monospace source.

**Tech Stack:** React 19, TypeScript (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`), Tiptap v3, Dexie, Vitest + Testing Library, Playwright, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-26-k1-image-capture-design.md`

## Global Constraints

- **All six gates before any commit:** `npm run typecheck`, `npm run lint`, `npm run format`, `npm test -- --run --maxWorkers=4`, `npm run build`, `npm run test:e2e`. Cheap tier every task; expensive tier at the boundaries named below.
- **Limits, exact:** reject > **25 MB**; downscale to **≤ 2048px** on the long edge; encode **`image/webp` at quality 0.8**.
- **Markdown form, exact:** `![alt](files/<id>.webp)`. Never a `bear://` scheme, never an absolute URL.
- **Remote image URLs must keep rendering as monospace source.** A test asserting this is part of Task 4 and must not be weakened.
- **No user-facing string is hardcoded.** `useT`, with the key added to BOTH `src/i18n/en.ts` and `src/i18n/ko.ts`.
- **Every colour from a CSS custom property**; spacing from `sourceLint`'s permitted subset (`0 0.5 1 2 3 4 6 8 12 px auto full`).
- **Duck-type, never `instanceof Blob`** — `vitest.setup.ts` swaps the global `Blob` for Node's, so `instanceof` is false under test and true in a browser.
- **`npm run build` typechecks test files too.** `vitest run` does not. A test using an undeclared global passes locally and fails the build.
- **Before any e2e run following a source change:** `lsof -ti:4173 | xargs -r kill -9`.

---

### Task 1: the downscaler

**Files:**

- Create: `src/features/notes/downscale.ts`
- Create: `src/features/notes/downscale.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export const MAX_SOURCE_BYTES = 25 * 1024 * 1024`
  - `export const MAX_EDGE_PX = 2048`
  - `export const WEBP_QUALITY = 0.8`
  - `export interface DownscaledImage { blob: Blob; width: number; height: number }`
  - `export interface DownscaleDeps { createBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>; encode?: (bitmap: unknown, width: number, height: number) => Promise<Blob> }`
  - `export async function downscaleImage(file: Blob, deps?: DownscaleDeps): Promise<DownscaledImage | null>` — `null` for a non-image or an oversized file.

- [ ] **Step 1: Write the failing test**

`OffscreenCanvas` and `createImageBitmap` do not exist in jsdom, which is why the two browser calls are injected. The real encode is covered in Playwright (Task 6).

```ts
import { describe, expect, it, vi } from 'vitest';

import { downscaleImage, MAX_EDGE_PX, MAX_SOURCE_BYTES } from './downscale';

/** A fake bitmap + encoder, since jsdom has neither. */
function deps(source: { width: number; height: number }) {
  const encode = vi.fn(
    async (_bitmap: unknown, width: number, height: number) =>
      new Blob([new Uint8Array(width * height)], { type: 'image/webp' }),
  );
  return {
    encode,
    createBitmap: async () => ({ ...source, close: () => {} }),
  };
}

function imageBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

describe('downscaleImage', () => {
  it('caps the long edge and preserves the aspect ratio', async () => {
    const d = deps({ width: 4000, height: 2000 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result).not.toBeNull();
    expect(result!.width).toBe(MAX_EDGE_PX);
    expect(result!.height).toBe(MAX_EDGE_PX / 2);
  });

  it('caps the long edge when the image is portrait', async () => {
    const d = deps({ width: 1000, height: 5000 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result!.height).toBe(MAX_EDGE_PX);
    expect(result!.width).toBe(Math.round(MAX_EDGE_PX / 5));
  });

  it('never UPSCALES a small image', async () => {
    const d = deps({ width: 300, height: 200 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result!.width).toBe(300);
    expect(result!.height).toBe(200);
  });

  it('re-encodes even an image that needs no resizing', async () => {
    // Exactly one stored format means exactly one case for every downstream
    // path — the NodeView, the quota, K2's upload, K3's export.
    const d = deps({ width: 300, height: 200 });

    const result = await downscaleImage(imageBlob(), d);

    expect(result!.blob.type).toBe('image/webp');
    expect(d.encode).toHaveBeenCalledTimes(1);
  });

  it('rejects a file over the source limit without decoding it', async () => {
    const d = deps({ width: 100, height: 100 });
    const huge = new Blob([new Uint8Array(10)], { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: MAX_SOURCE_BYTES + 1 });

    expect(await downscaleImage(huge, d)).toBeNull();
    // Not merely "returns null": decoding a 30MB paste before rejecting it is
    // the part that would freeze the tab.
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('rejects a non-image', async () => {
    const d = deps({ width: 100, height: 100 });

    expect(await downscaleImage(new Blob(['x'], { type: 'text/plain' }), d)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/features/notes/downscale.test.ts`
Expected: FAIL — cannot resolve `./downscale`.

- [ ] **Step 3: Implement**

```ts
/** A mis-paste guard, not a storage budget: the downscale runs after it. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Long edge. A 2048px WebP is sharp on every display this app runs on. */
export const MAX_EDGE_PX = 2048;
export const WEBP_QUALITY = 0.8;

export interface DownscaledImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface DownscaleDeps {
  createBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  encode?: (bitmap: unknown, width: number, height: number) => Promise<Blob>;
}

function fit(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE_PX) return { width, height };
  const scale = MAX_EDGE_PX / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * One WebP per image, at most `MAX_EDGE_PX` on its long edge.
 *
 * `null` rather than a throw for the two refusals: an oversized paste and a
 * non-image are both ordinary things a user does, and the caller's answer to
 * each is to fall through to the default paste rather than to handle an error.
 *
 * The two browser calls are INJECTED because jsdom implements neither
 * `createImageBitmap` nor `OffscreenCanvas`. The real encode is exercised in
 * Playwright; these tests cover the arithmetic and the refusals, which is
 * where the bugs are.
 */
export async function downscaleImage(
  file: Blob,
  deps: DownscaleDeps = {},
): Promise<DownscaledImage | null> {
  // Duck-typed, not `instanceof`: `vitest.setup.ts` swaps the global `Blob`.
  if (!file.type.startsWith('image/')) return null;
  // Checked BEFORE decoding — decoding a 30MB paste is what freezes the tab.
  if (file.size > MAX_SOURCE_BYTES) return null;

  const createBitmap = deps.createBitmap ?? ((blob: Blob) => createImageBitmap(blob));
  const encode =
    deps.encode ??
    (async (bitmap: unknown, width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context');
      context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
      return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    });

  const bitmap = await createBitmap(file);
  try {
    const size = fit(bitmap.width, bitmap.height);
    const blob = await encode(bitmap, size.width, size.height);
    return { blob, width: size.width, height: size.height };
  } finally {
    bitmap.close?.();
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/notes/downscale.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/notes/downscale.ts src/features/notes/downscale.test.ts
git commit -m "feat(images): one WebP per image, capped at 2048px"
```

---

### Task 2: `FileRecord` gains dimensions, and `files.add` changes shape

**Files:**

- Modify: `src/data/types.ts`, `src/data/db.ts`, `src/data/repositories/files.ts`, `src/data/repositories/files.test.ts`, `e2e/fixtures/seed.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `FileRecord` = `{ id, noteId, blob, mime, width, height, bytes, createdAt }`; `files.add(noteId: string, blob: Blob, meta: { mime: string; width: number; height: number }): Promise<FileRecord>`.

- [ ] **Step 1: Write the failing test**

Append to `src/data/repositories/files.test.ts`:

```ts
it('records the dimensions, size and time, so nothing downstream reads a blob to learn them', async () => {
  const blob = new Blob([new Uint8Array(1234)], { type: 'image/webp' });

  const record = await files.add('n1', blob, { mime: 'image/webp', width: 800, height: 600 });

  expect(record.width).toBe(800);
  expect(record.height).toBe(600);
  // Derived, never taken from the caller: the blob already knows its size, and
  // a caller-supplied number is a second source of truth for the same fact.
  expect(record.bytes).toBe(1234);
  expect(record.createdAt).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/data/repositories/files.test.ts`
Expected: FAIL — `add` takes three positional arguments, so `meta` arrives as `mime`.

- [ ] **Step 3: Implement**

In `src/data/types.ts`:

```ts
export interface FileRecord {
  id: string;
  noteId: string;
  blob: Blob;
  mime: string;
  /** After downscaling. Lets a placeholder reserve the right box before the blob resolves. */
  width: number;
  height: number;
  /** `blob.size`, denormalised so K2's quota check never reads a blob. */
  bytes: number;
  createdAt: number;
}
```

In `src/data/repositories/files.ts`, take a `now` dep the way `notes.ts` does, and:

```ts
async add(noteId, blob, meta) {
  const record: FileRecord = {
    id: generateId(),
    noteId,
    blob,
    mime: meta.mime,
    width: meta.width,
    height: meta.height,
    bytes: blob.size,
    createdAt: now(),
  };
  await db.files.add(record);
  return record;
},
```

In `src/data/db.ts`, add version 4. **No `.upgrade()` hook**: nothing has ever written a `files` row (the repository has no call sites), so there is nothing to migrate, and inventing dimensions for a hypothetical row would be a guess.

```ts
// Version 4 adds image metadata to `files`. The store's KEYS are unchanged —
// only the record shape grows — but Dexie needs a version to notice.
//
// Dexie multiplies declared versions by ten, so this is IndexedDB version 40,
// and `e2e/fixtures/seed.ts` MUST move with it in the same commit. Seeding at
// the wrong number leaves Dexie wanting an upgrade that a still-open
// connection blocks forever: `openDatabase()` never settles, `main.tsx` never
// calls `createRoot`, and the page renders as a bare `#root` with one
// `console.warn` as the only clue.
this.version(4).stores({
  files: 'id, noteId',
});
```

- [ ] **Step 4: Move the seed in the SAME commit**

In `e2e/fixtures/seed.ts` change the `indexedDB.open` version from 30 to 40 and update the docblock's "`version(3)` … is 30" sentence to name version 4 and 40.

- [ ] **Step 5: Run the tests, including an e2e that proves the app still boots**

```bash
npx vitest run src/data/
lsof -ti:4173 | xargs -r kill -9 && npx playwright test e2e/smoke.spec.ts
```

Expected: PASS. If the page renders empty, the seed version is wrong — that is the failure this step exists to catch.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/data e2e/fixtures/seed.ts
git commit -m "feat(images): files records carry dimensions, size and time"
```

---

### Task 3: the stored-path contract

**Files:**

- Create: `src/features/notes/storedImagePath.ts`, `src/features/notes/storedImagePath.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function storedImagePath(id: string): string`; `export function storedImageId(path: string): string | null`; `export function storedImageIds(markdown: string): string[]`.

`src/features/notes/` rather than `src/data/`, and NOT `src/features/editor/`: the editor and the reclamation sweep both need it, and `src/data/` must not import from `src/features/` (see `parseTags`' placement for the same argument in reverse).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { storedImageId, storedImageIds, storedImagePath } from './storedImagePath';

describe('storedImagePath', () => {
  it('round-trips an id', () => {
    expect(storedImageId(storedImagePath('abc123'))).toBe('abc123');
  });

  it('is a relative path, not a scheme', () => {
    // Load-bearing: a relative path is device-independent for sync AND makes
    // an exported folder a portable Markdown bundle.
    expect(storedImagePath('abc123')).toBe('files/abc123.webp');
  });

  it.each([
    ['an absolute URL that merely contains the shape', 'https://x.example/files/abc.webp'],
    ['a traversal attempt', 'files/../../etc/passwd.webp'],
    ['a different extension', 'files/abc.png'],
    ['a nested path', 'files/sub/abc.webp'],
    ['an empty id', 'files/.webp'],
    ['a plain remote URL', 'https://example.com/a.png'],
  ])('does not match %s', (_what, path) => {
    expect(storedImageId(path)).toBeNull();
  });

  it('collects every referenced id from a note', () => {
    const markdown = [
      'Trip',
      `![beach](${storedImagePath('one')})`,
      'words',
      `![](${storedImagePath('two')})`,
      '![remote](https://example.com/x.png)',
    ].join('\n');

    expect(storedImageIds(markdown)).toEqual(['one', 'two']);
  });

  it('collects each id once, however many times it appears', () => {
    const markdown = `![](${storedImagePath('one')}) and again ![](${storedImagePath('one')})`;

    expect(storedImageIds(markdown)).toEqual(['one']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/features/notes/storedImagePath.test.ts`

- [ ] **Step 3: Implement**

```ts
/**
 * The Markdown reference for a stored image: `files/<id>.webp`.
 *
 * A relative path rather than a `bear://` scheme or an absolute URL, and the
 * choice is irreversible — it cannot change without rewriting every note that
 * has an image. Two properties pay for it: sync moves note text verbatim, so a
 * device-independent path needs no rewriting on the way in or out; and a note
 * exported beside a `files/` directory is a Markdown bundle that opens in any
 * editor, with no app-specific syntax to strip.
 */
const PATTERN = /^files\/([A-Za-z0-9_-]+)\.webp$/;

export function storedImagePath(id: string): string {
  return `files/${id}.webp`;
}

/** The id in a stored-image path, or `null` for anything else — a remote URL included. */
export function storedImageId(path: string): string | null {
  return PATTERN.exec(path)?.[1] ?? null;
}

/**
 * Every stored-image id a note references, in order, deduplicated.
 *
 * Deduplicated because the reclamation sweep asks "is this file still
 * referenced", and one image used twice is referenced once as far as that
 * question goes.
 */
export function storedImageIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const id = storedImageId(match[1]);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 4: Run the test**

Expected: PASS, 10 tests.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/notes/storedImagePath.ts src/features/notes/storedImagePath.test.ts
git commit -m "feat(images): the stored-image path contract"
```

---

### Task 4: the `StoredImage` node and its object-URL cache

**Files:**

- Create: `src/features/editor/StoredImage.ts`, `src/features/editor/objectUrls.ts`, `src/features/editor/objectUrls.test.ts`, `src/features/editor/storedImage.test.ts`
- Modify: `src/features/editor/extensions.ts`, `src/features/editor/markdown.test.ts`, `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `storedImageId`, `storedImagePath` (Task 3); `files` from `@/data`.
- Produces: `export const StoredImage: Node`; `export function acquireObjectUrl(id, load): Promise<string | null>`; `export function releaseObjectUrl(id): void`. i18n key `'editor.image.missing'` (`'Image not on this device yet'` / `'이 기기에 아직 없는 이미지입니다'`).

- [ ] **Step 1: Write the failing object-URL test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireObjectUrl, releaseObjectUrl } from './objectUrls';

describe('object URL cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates ONE url for a file however many consumers ask', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    const load = vi.fn(async () => new Blob(['x']));

    const first = await acquireObjectUrl('a', load);
    const second = await acquireObjectUrl('a', load);

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    // Not just the URL: the BLOB is read once too. Two consumers of the same
    // image must not each hit IndexedDB.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('revokes only when the last consumer releases', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const load = async () => new Blob(['x']);

    await acquireObjectUrl('a', load);
    await acquireObjectUrl('a', load);

    releaseObjectUrl('a');
    expect(revoke).not.toHaveBeenCalled();

    releaseObjectUrl('a');
    expect(revoke).toHaveBeenCalledWith('blob:one');
  });

  it('is null for a file that is not stored, without caching the miss forever', async () => {
    const load = vi.fn(async () => null);

    expect(await acquireObjectUrl('missing', load)).toBeNull();
    // The bytes may arrive later (K2). A cached miss would leave the
    // placeholder on screen for the life of the tab.
    expect(await acquireObjectUrl('missing', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/features/editor/objectUrls.test.ts`

- [ ] **Step 3: Implement the cache**

```ts
interface Entry {
  url: string;
  count: number;
}

/**
 * One object URL per stored file, reference-counted.
 *
 * Module scope deliberately: a NodeView remounts whenever ProseMirror redraws
 * the node, and a per-instance URL would be created and leaked on every
 * redraw. Creating one per render is the obvious implementation and is wrong —
 * a note scrolled on a phone accumulates them for the life of the tab, and
 * nothing in the app or the test suite would report it.
 */
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<string | null>>();

export async function acquireObjectUrl(
  id: string,
  load: (id: string) => Promise<Blob | null>,
): Promise<string | null> {
  const existing = entries.get(id);
  if (existing !== undefined) {
    existing.count += 1;
    return existing.url;
  }

  // Two NodeViews mounting in the same tick must not both read the blob.
  const inFlight = pending.get(id);
  if (inFlight !== undefined) return inFlight;

  const promise = (async () => {
    const blob = await load(id);
    // A miss is NOT cached: the bytes can arrive later (K2), and a cached miss
    // would leave the placeholder on screen for the life of the tab.
    if (blob === null) return null;
    const url = URL.createObjectURL(blob);
    entries.set(id, { url, count: 1 });
    return url;
  })().finally(() => pending.delete(id));

  pending.set(id, promise);
  return promise;
}

export function releaseObjectUrl(id: string): void {
  const entry = entries.get(id);
  if (entry === undefined) return;
  entry.count -= 1;
  if (entry.count > 0) return;
  URL.revokeObjectURL(entry.url);
  entries.delete(id);
}
```

- [ ] **Step 4: Run it**

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing node test**

`src/features/editor/storedImage.test.ts`, modelled on the existing editor node tests: mount an editor with `initialMarkdown` holding a stored path, assert an `<img>` appears once the blob resolves, assert the placeholder appears for a missing file, and assert the URL is released on destroy.

```tsx
it('renders an img for a stored image', async () => {
  await files.add('n1', new Blob(['x'], { type: 'image/webp' }), {
    mime: 'image/webp',
    width: 10,
    height: 10,
  });
  // …mount with `![](files/<id>.webp)` and await the img
});

it('shows the placeholder for a file this device does not have', async () => {
  // …mount with `![](files/nope.webp)`; expect the translated missing text,
  // and NOT a broken <img>.
});

it('leaves a remote URL as monospace source', async () => {
  // The privacy property: opening a note must not fetch from a third party.
  // Assert `RawImage`'s span, not an <img>.
});
```

- [ ] **Step 6: Implement `StoredImage`**

A Tiptap `Node`, `inline`, `atom`, `group: 'inline'`, with `src` and `alt` attributes, `markdownTokenName: 'image'`, and:

- `parseMarkdown`: return a `storedImage` node when `storedImageId(token.href)` is non-null, and **`false` otherwise so `RawImage` still claims it** — check how `RawBlock.ts` sequences competing handlers before wiring this, and register `StoredImage` BEFORE `RawImage` in `extensions.ts`.
- `renderMarkdown`: `![${alt}](${src})`, byte-identical.
- `addNodeView`: a plain-DOM view (not React — the editor's other widgets are plain DOM, and a React view here would need a portal for one `<img>`). On mount, `acquireObjectUrl(id, (fid) => files.get(fid).then((r) => r?.blob ?? null))`; set `img.src` when it resolves; `releaseObjectUrl(id)` in `destroy()`. Reserve the box from the record's `width`/`height` so the text does not reflow.

- [ ] **Step 7: Add the round-trip fixture**

Add to `CANONICAL` in `src/features/editor/markdown.test.ts`:

```ts
{ name: 'stored image', markdown: '![beach](files/abc123.webp)' },
```

The `fidelity` and `totality` suites both iterate `CANONICAL`, so this is the whole round-trip guarantee.

- [ ] **Step 8: Run the editor tests**

Run: `npx vitest run src/features/editor/`
Expected: PASS.

- [ ] **Step 9: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor src/i18n
git commit -m "feat(images): a node that renders a stored image, and one URL per file"
```

---

### Task 5: paste and drop

**Files:**

- Create: `src/features/editor/ImagePaste.ts`
- Modify: `src/features/editor/extensions.ts`, `src/features/notes/NoteEditor.tsx`, `src/i18n/en.ts`, `src/i18n/ko.ts`
- Create: `src/features/editor/imagePaste.test.ts`

**Interfaces:**

- Consumes: `downscaleImage` (Task 1), `files` + `storedImagePath` (Tasks 2, 3).
- Produces: `export const ImagePaste: Extension` with options `{ onImage: ((file: Blob) => Promise<string | null>) | null }` — the callback returns the Markdown path to insert, or `null` if the image was refused. i18n key `'editor.image.tooLarge'` (`'That image is too large (25 MB maximum).'` / `'이미지가 너무 큽니다 (최대 25MB).'`).

The extension carries **no product knowledge**: it finds image files on a paste or drop and hands them up, exactly as `TagPill.onActivate` and `ContextMenu.onOpen` do. `NoteEditor` owns the note id, the downscale and the store.

- [ ] **Step 1: Write the failing test**

```ts
it('hands a pasted image up and inserts what the callback returns', async () => {
  // Dispatch a paste with a DataTransfer holding an image File; assert
  // `onImage` was called with it and the returned path is in the document.
});

it('ignores a paste with no image, so pasting text still pastes text', async () => {
  // The regression that would be easy to ship: claiming every paste.
});

it('is inert when `onImage` is null', async () => {
  // Same rule as `ContextMenu.onOpen`: an unwired extension must not
  // preventDefault and swallow the browser's own behaviour.
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/features/editor/imagePaste.test.ts`

- [ ] **Step 3: Implement**

A ProseMirror plugin with `handleDOMEvents.paste` and `.drop`. Take image files off `event.clipboardData?.files` / `event.dataTransfer?.files`; if there are none, **return false** so the default paste runs. If `onImage` is `null`, return false. Otherwise `preventDefault`, and for each file `await onImage(file)` then insert `![](path)` at the caret through the `tr`/`dispatch` the handler is given.

**Do not call `editor.commands.*` from inside the handler** — dispatching inside a Tiptap command throws `RangeError: Applying a mismatched transaction`. Work through the view's own `state`/`dispatch`.

**Prefix the option `onImage`, not `onPaste`.** `buildEditorExtensions` spreads every extension's options into ONE object, so a colliding name silently loses — `TableHandles.onOpenMenu` already collided with `HeadingFold`'s.

- [ ] **Step 4: Wire `NoteEditor`**

```tsx
const handleImage = useCallback(
  async (file: Blob): Promise<string | null> => {
    const image = await downscaleImage(file);
    if (image === null) {
      setImageFailed(true);
      return null;
    }
    const record = await files.add(note.id, image.blob, {
      mime: 'image/webp',
      width: image.width,
      height: image.height,
    });
    return storedImagePath(record.id);
  },
  [note.id],
);
```

Render the refusal through the existing `role="status"` strip at the bottom of `NoteEditor`, alongside the save and export failures — do not add a second status region.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/editor/ src/features/notes/NoteEditor.test.tsx`

- [ ] **Step 6: Gate boundary — full unit suite**

Run: `npm test -- --run --maxWorkers=4`

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features src/i18n
git commit -m "feat(images): paste or drop a screenshot into a note"
```

---

### Task 6: reclamation, and the undo that must survive it

**Files:**

- Modify: `src/data/repositories/notes.ts`, `src/data/repositories/notes.test.ts`
- Create: `src/data/repositories/sweepFiles.ts` — actually **inline it in `notes.save`**; a one-function module for four lines used once is worse than the four lines.

**Interfaces:**

- Consumes: `storedImageIds` (Task 3).
- Produces: no new exports. `notes.save` gains the sweep.

**`src/data/` must not import from `src/features/`.** `storedImageIds` lives in `src/features/notes/`, so it is **injected at `src/data/repositories/index.ts`**, exactly as `parseTags` already is. Read that wiring before writing this.

- [ ] **Step 1: Write the failing tests**

```ts
describe('image reclamation', () => {
  it('removes a file whose reference the user deleted', async () => {
    const note = await notes.create(`![](files/${'x'.repeat(4)}.webp)`);
    const file = await files.add(note.id, blob, meta); // id forced via the test generator
    await notes.save(note.id, 'no image any more');

    expect(await files.get(file.id)).toBeUndefined();
  });

  it('keeps a file the text still references', async () => {
    // The failure mode that matters: an over-eager sweep deleting live data.
  });

  it('keeps a file belonging to a DIFFERENT note', async () => {
    // `listForNote` scopes it, but a sweep written against `db.files` as a
    // whole would pass every other test in this block and destroy other
    // notes' images.
  });

  it('sweeps from the text being WRITTEN, not from a cached read', async () => {
    // `notes-lifecycle.md`: a `useLiveQuery` value is a cache and must never
    // gate a write. Same hazard, one layer down.
  });
});
```

And, in `src/features/notes/NoteEditor.test.tsx`, the one that guards data loss:

```tsx
it('an image deleted and then undone is still stored', async () => {
  // Delete the reference, let autosave fire, undo, let it fire again, and
  // assert the blob is still readable. This is the only path in K1 where a
  // bug destroys something the user cannot get back.
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/data/repositories/notes.test.ts`

- [ ] **Step 3: Implement inside `notes.save`'s existing transaction**

Add `db.files` to the transaction's table list, and after the `put`:

```ts
const referenced = new Set(storedImageIds(text));
const stored = await db.files.where('noteId').equals(id).toArray();
for (const file of stored) {
  if (!referenced.has(file.id)) await db.files.delete(file.id);
}
```

Inside the transaction and from `text` — the string being written — never from a value read elsewhere.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/data/ src/features/notes/NoteEditor.test.tsx`

- [ ] **Step 5: Prove the sweep can delete what it should not**

Change the sweep to compare against `db.files.toArray()` instead of the note's own files. The "keeps a file belonging to a DIFFERENT note" test must FAIL. Restore. A reclamation sweep that has never been shown to over-delete is not verified.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/data src/features/notes/NoteEditor.test.tsx
git commit -m "fix(images): reclaim a file whose reference was deleted, and only that file"
```

---

### Task 7: the real browser, and the pictures

**Files:**

- Create: `e2e/images.spec.ts`
- Modify: `e2e/shots-mobile.spec.ts` or add a shot to `e2e/shots.spec.ts`

- [ ] **Step 1: Write the e2e**

jsdom has neither `createImageBitmap` nor `OffscreenCanvas`, so **this is the only place a real WebP is ever produced.** Build a real PNG in the page, put it on a `DataTransfer`, dispatch a paste:

```ts
test('a pasted image is stored, rendered, and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();

  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4a7';
    ctx.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });

  const img = editor.locator('img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  // The BYTES, not just an element: a broken img still has a src.
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  await page.reload();
  await page.getByRole('button', { name: /Untitled|shot/ }).first().click();
  await expect(editor.locator('img')).toHaveAttribute('src', /^blob:/);
});
```

Also assert the note's Markdown holds `files/…webp` (read it out of IndexedDB), and that **an oversized paste shows the refusal and inserts nothing**.

- [ ] **Step 2: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/images.spec.ts
```

- [ ] **Step 3: Prove it can fail**

Make `downscaleImage` return `null` unconditionally. The test must fail on the missing `<img>`. Restore.

- [ ] **Step 4: Take a screenshot and LOOK at it**

Add a shot of a note with an image to the mobile shots spec, run `npm run shots:mobile`, and open it. Check the image fits the column, does not overflow on a phone, and that the WebP at q80 has not visibly softened text in the screenshot. **If it has, raise the quality — it is one constant.** Nothing in the suite can judge this.

- [ ] **Step 5: Full gate**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
```

- [ ] **Step 6: Commit**

```bash
git add e2e
git commit -m "test(images): a real paste, a real WebP, a real reload"
```

---

### Task 8: rulings and CLAUDE.md

**Files:** `docs/rulings/markdown-and-schema.md`, `docs/rulings/notes-lifecycle.md`, `docs/rulings/tag-index-and-startup.md`, `CLAUDE.md`, `docs/superpowers/NEXT.md`

- [ ] **Step 1: Record the rulings**

`markdown-and-schema.md`: the `files/<id>.webp` contract and why a relative path rather than a scheme; `StoredImage` before `RawImage` in the extension order; remote URLs still render as source, and that this is a privacy decision rather than an unfinished one.

`notes-lifecycle.md`: the reclamation sweep runs inside `notes.save`'s transaction, from the text being written; `storedImageIds` is injected at `repositories/index.ts` because `src/data/` must not import `src/features/`; and undo must survive it.

`tag-index-and-startup.md`: `db.version(4)` is IndexedDB 40 and `e2e/fixtures/seed.ts` moves with it.

- [ ] **Step 2: Update CLAUDE.md**

Add the K1 row. Update the test counts from the real run output. Add the toolchain note: **jsdom implements neither `createImageBitmap` nor `OffscreenCanvas`**, so the downscaler injects both and the only real encode in the suite is in Playwright. Amend the goal paragraph — image storage is no longer entirely unscheduled.

- [ ] **Step 3: Update NEXT.md** with K1–K4, K1 shipped.

- [ ] **Step 4: Final gate and commit**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4 && npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
git add docs CLAUDE.md && git commit -m "docs(k1): record the image-capture rulings"
```

---

## Self-review

**Spec coverage.** Pipeline → Tasks 1, 5. Markdown contract → Task 3, fixture in Task 4. Editor node and the three states → Task 4. Object-URL lifecycle → Task 4. Reclamation and the undo test → Task 6. Data layer and the Dexie bump → Task 2. Testing → Tasks 1–7. Non-goals are untouched: no server, no resize, no export change, no thumbnail rewire.

**Placeholders.** Task 4 Step 6 and Task 6 Step 1 describe rather than show in places — deliberately: the node view's exact shape depends on `RawBlock.ts`'s handler sequencing, which the implementer must read rather than take from a sketch, and this project has been bitten by a plan that guessed a signature (`Icon`'s prop, `TestI18nProvider`). Each names the file to read and the constraint to satisfy.

**Type consistency.** `DownscaledImage { blob, width, height }` produced in Task 1 is consumed with those names in Task 5. `files.add(noteId, blob, { mime, width, height })` defined in Task 2 is called with that shape in Task 5. `storedImagePath` / `storedImageId` / `storedImageIds` defined in Task 3 are used under those names in Tasks 4, 5 and 6. `acquireObjectUrl(id, load)` / `releaseObjectUrl(id)` defined and consumed within Task 4.
