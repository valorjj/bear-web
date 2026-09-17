# Editor code splitting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the rich text editor off the first-paint critical path so the
note list appears ~500 ms sooner on a slow connection, without making the
editor arrive later for someone who opens the app to type.

**Architecture:** Three static import edges currently drag the whole
Tiptap/ProseMirror stack into the eager bundle: the `@/features/notes` barrel
re-exporting `NoteEditor`, `useExportRunner`'s static import of `exportNote`,
and `AppShell`'s direct render of `NoteEditor`. Cut all three, wrap
`NoteEditor` in `React.lazy`, then warm the chunk with a preload once the
shell has painted so the writer's path does not regress.

**Tech Stack:** React 19 `lazy`/`Suspense`, Rolldown (via Vite 7), Vitest,
Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-editor-code-splitting-design.md`

## Global Constraints

- **Every gate must pass before any commit:** `npm run typecheck`,
  `npm run lint`, `npm run format`, `npm test`, `npm run test:e2e`,
  `npm run build`.
- **Kill port 4173 before any e2e run that follows a source change:**
  `lsof -ti:4173 | xargs -r kill -9`. A stale preview server silently tests
  the previous build.
- **The bundle guard is `scripts/bundleSize.test.ts`**, part of `npm test`.
  `CEILING_BYTES` is currently `368_000`. Do not change it before Task 6.
- **Measure the eager closure like the guard does** — sum the gzipped entry
  chunk's transitive STATIC `imports` from `dist/.vite/manifest.json`, never
  the Vite build log's gzip estimate, which reads ~3 KB high.
- **`src/ui/` and `src/lib/` may import nothing** from `src/app/`,
  `src/data/`, `src/features/` or `src/i18n/`; enforced by
  `scripts/sourceLint.test.ts`.
- **Only permitted spacing steps** (Tailwind `0 0.5 1 2 3 4 6 8 12`, `px`,
  `auto`, `full`), enforced by the same file.
- **No user-facing string is hardcoded**; everything goes through `useT`, and
  `src/i18n/ko.ts` is `Record<TranslationKey, string>` so a missing Korean
  translation is a compile error.
- **Baseline to beat, measured on `main` at `65d42fa`:** eager closure
  **364,303 B** gzipped; `npm run measure:load` reports first note visible at
  **2,482 ms** on 4x CPU / Slow 4G.

---

### Task 1: `useExportRunner` loads the exporter on demand

The export path is the first of the three doors. `NoteList` imports
`useExportRunner`, which statically imports `exportNote`, which imports
`html.ts`, which imports `@/features/editor`. Export is always user-initiated,
so an `import()` at the call site is the natural shape.

**Files:**

- Modify: `src/features/export/useExportRunner.ts`
- Test: `src/features/export/useExportRunner.test.tsx` (create if absent)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `useExportRunner(): ExportRunner` — unchanged public shape,
  `{ run: (note: ExportableNote, format: ExportFormat) => void; failureKey: TranslationKey | null }`.
  Later tasks rely on this signature being untouched.

- [ ] **Step 1: Write the failing test**

Create or extend `src/features/export/useExportRunner.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExportProgressProvider } from './ExportProgressContext';
import { useExportRunner } from './useExportRunner';

vi.mock('./exportNote', () => ({
  exportNote: vi.fn(async () => undefined),
}));

/**
 * The module must be reached through `await import()`, not a static import,
 * or the whole Tiptap stack rides into the eager bundle behind it. A mock
 * alone cannot see the difference — both forms resolve to the mock — so this
 * asserts the OBSERVABLE consequence instead: the runner still works when
 * the module is only available asynchronously, and `exportNote` is called
 * with exactly what the caller passed.
 */
describe('useExportRunner', () => {
  it('runs an export through the dynamically imported module', async () => {
    const { exportNote } = await import('./exportNote');

    const { result } = renderHook(() => useExportRunner(), {
      wrapper: ({ children }) => <ExportProgressProvider>{children}</ExportProgressProvider>,
    });

    const note = { id: 'n1', title: 'Title', text: 'Title\n\nBody' };
    act(() => {
      result.current.run(note, 'md');
    });

    await waitFor(() => {
      expect(exportNote).toHaveBeenCalledWith(note, 'md', expect.any(String));
    });
    expect(result.current.failureKey).toBeNull();
  });

  it('reports a failure key when the export rejects', async () => {
    const { exportNote } = await import('./exportNote');
    vi.mocked(exportNote).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useExportRunner(), {
      wrapper: ({ children }) => <ExportProgressProvider>{children}</ExportProgressProvider>,
    });

    act(() => {
      result.current.run({ id: 'n1', title: 'T', text: 'T' }, 'md');
    });

    await waitFor(() => {
      expect(result.current.failureKey).toBe('export.failed');
    });
  });
});
```

- [ ] **Step 2: Run it and watch it pass against the CURRENT code**

Run: `npx vitest run src/features/export/useExportRunner.test.tsx`

Expected: PASS. This is deliberate and is the point of the next step — a
behaviour test cannot distinguish a static import from a dynamic one, so the
real guard for this task is the byte measurement in Step 5 and the static
check in Task 2. Record the pass so a later failure is meaningful.

- [ ] **Step 3: Make the import dynamic**

In `src/features/export/useExportRunner.ts`, change the value import to a
type-only import and load the module inside the callback:

```ts
import type { ExportableNote, ExportFormat } from './exportNote';
```

(the previous line was
`import { exportNote, type ExportableNote, type ExportFormat } from './exportNote';`)

Then inside `run`'s `go`:

```ts
      const go = async (): Promise<void> => {
        if (format === 'pdf') begin();
        try {
          setFailureKey(null);
          // Dynamic, and load-bearing rather than stylistic: `exportNote`
          // reaches `html.ts`, which imports `@/features/editor` and with it
          // the whole Tiptap/ProseMirror stack. A static import here puts
          // ~130 KB gzipped on the first-paint critical path for a feature
          // nobody has asked for yet. `import type` above is erased, so it
          // adds no edge.
          const { exportNote } = await import('./exportNote');
          await exportNote(note, format, locale);
        } catch (error) {
          const reason = error instanceof PdfExportError ? error.reason : 'failed';
          setFailureKey(EXPORT_FAILURE_KEYS[reason] ?? 'export.failed');
        } finally {
          if (format === 'pdf') end();
        }
      };
```

Leave the `begin()`/`end()` pairing exactly as it is — the `finally` is
documented as load-bearing in this file's own docblock.

- [ ] **Step 4: Run the test again**

Run: `npx vitest run src/features/export/useExportRunner.test.tsx`
Expected: PASS, both cases.

- [ ] **Step 5: Measure the eager closure**

```bash
npm run build >/dev/null 2>&1 && node -e "
const fs=require('fs'),zlib=require('zlib');
const m=JSON.parse(fs.readFileSync('dist/.vite/manifest.json','utf8'));
const seen=new Set(); const walk=k=>{if(seen.has(k))return;seen.add(k);(m[k].imports||[]).forEach(walk)};
walk(Object.keys(m).find(k=>m[k].isEntry));
let t=0; for(const k of seen){const f='dist/'+m[k].file; if(f.endsWith('.js')) t+=zlib.gzipSync(fs.readFileSync(f)).length;}
console.log('eager gzip', t);
"
```

Expected: **still ~364,303 B, essentially unchanged.** This is correct and
expected — the barrel in Task 2 is holding the door open, and this task alone
saved 86 B when measured during the spike. Write the number down; Task 5
compares against it.

- [ ] **Step 6: Run the full gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9; npm run test:e2e
git add src/features/export/useExportRunner.ts src/features/export/useExportRunner.test.tsx
git commit -m "refactor(export): load the exporter on demand, not at boot"
```

---

### Task 2: `NoteEditor` leaves the notes barrel

The barrel is the door that matters. `src/features/notes/index.ts` re-exports
`NoteEditor`, so importing ANYTHING from `@/features/notes` — which `AppShell`
does — pulls the editor stack in statically. Measured during the spike: with
this edge left in place, every other change in this plan saves 86 bytes.

**Files:**

- Modify: `src/features/notes/index.ts`
- Modify: `src/app/AppShell.tsx` (import site only; the lazy wrapper is Task 3)
- Modify: `src/app/AppShell.test.tsx` (it mocks `NoteEditor` through the barrel)
- Test: `scripts/sourceLint.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `NoteEditor` and `NoteEditorProps` are importable ONLY from
  `@/features/notes/NoteEditor`. Task 3 imports from that path.

- [ ] **Step 1: Write the failing test**

Append to `scripts/sourceLint.test.ts`:

```ts
describe('the editor stays off the first-paint path', () => {
  /*
   * `src/features/notes/index.ts` re-exported `NoteEditor`, and that single
   * line defeated every attempt to code-split the editor: importing anything
   * at all from `@/features/notes` pulls `NoteEditor` in statically, and with
   * it Tiptap, ProseMirror, highlight.js and marked — about 130 KB gzipped on
   * the critical path of a note list that never uses any of it. Measured
   * twice during the 2026-09-17 spike: with this edge present, a `React.lazy`
   * boundary around the editor saved 86 bytes, and closing the export door as
   * well saved nothing at all.
   *
   * A grep rather than a byte check because the byte check cannot say WHY it
   * regressed, and this is the one line that does it.
   */
  it('keeps NoteEditor out of the notes barrel', () => {
    const barrel = readFileSync('src/features/notes/index.ts', 'utf8');
    expect(barrel).not.toMatch(/from '\.\/NoteEditor'/);
  });

  it('lets only AppShell reach NoteEditor, and only lazily', () => {
    const offenders: string[] = [];
    for (const path of walk('src', ['.ts', '.tsx'])) {
      if (/\.test\.tsx?$/.test(path)) continue;
      if (path.endsWith('src/features/notes/NoteEditor.tsx')) continue;
      const source = readFileSync(path, 'utf8');
      // A STATIC import of the module is the regression; `import(...)` is the
      // shape this sub-project exists to establish.
      if (/^import[^\n]*from '[^']*notes\/NoteEditor'/m.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/sourceLint.test.ts`
Expected: FAIL — "keeps NoteEditor out of the notes barrel" fails, because the
barrel still has the line.

- [ ] **Step 3: Remove the barrel export**

In `src/features/notes/index.ts`, delete these two lines:

```ts
export { NoteEditor } from './NoteEditor';
export type { NoteEditorProps } from './NoteEditor';
```

and add a comment in their place so the next person does not restore them:

```ts
// `NoteEditor` is deliberately NOT re-exported here. It reaches the whole
// Tiptap/ProseMirror stack, and a barrel re-export makes that stack a
// STATIC dependency of anything importing from `@/features/notes` — which
// includes `AppShell`, which is the entry path. `AppShell` imports it
// lazily by path instead. `scripts/sourceLint.test.ts` fails if this comes
// back. See docs/superpowers/specs/2026-09-17-editor-code-splitting-design.md.
```

- [ ] **Step 4: Fix the two importers**

In `src/app/AppShell.tsx`, remove `NoteEditor,` from the
`from '@/features/notes'` import list and add, with the other local imports:

```ts
import { NoteEditor } from '@/features/notes/NoteEditor';
```

(Task 3 replaces this line with the lazy form. It is a plain import here so
this task is independently green.)

In `src/app/AppShell.test.tsx`, the mock reaches `NoteEditor` through the
barrel and will fail typecheck. Repoint it at the module:

```tsx
vi.mock('@/features/notes/NoteEditor', () => ({
  NoteEditor: () => <div data-testid="note-editor" />,
}));
```

Read the file's existing mock first and preserve whatever props or testids its
assertions depend on — do not paste the snippet above blindly over a mock that
does more.

- [ ] **Step 5: Skip the second sourceLint case until Task 3**

The case "lets only AppShell reach NoteEditor, and only lazily" CANNOT pass
yet: Step 4 gave `AppShell.tsx` a static import of the module, which is
exactly what that test rejects. It becomes true in Task 3, where the import
turns into `import(...)`.

Mark it skipped, with the reason attached so it is not mistaken for a test
someone gave up on:

```ts
  // Skipped until Task 3 turns AppShell's import into `import(...)`. The
  // barrel edge is gone (the case above proves it); this one guards the
  // remaining static edge and is false by construction until then.
  it.skip('lets only AppShell reach NoteEditor, and only lazily', () => {
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run scripts/sourceLint.test.ts src/app/AppShell.test.tsx`
Expected: PASS, with one skip reported.

- [ ] **Step 7: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9; npm run test:e2e
git add -A
git commit -m "refactor(notes): NoteEditor leaves the barrel that pinned it eager"
```

---

### Task 3: `NoteEditor` mounts lazily, with a real fallback

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `scripts/sourceLint.test.ts` (re-enable the case skipped in Task 2)
- Test: `e2e/editorSplit.spec.ts` (create)

**Interfaces:**

- Consumes: `NoteEditor` importable from `@/features/notes/NoteEditor`
  (Task 2).
- Produces: the editor chunk exists as a `dynamicImports` entry in
  `dist/.vite/manifest.json`. Task 4 preloads it; Task 5 measures it.

- [ ] **Step 1: Write the failing test**

Create `e2e/editorSplit.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * The editor is not on the first-paint path, and it still works.
 *
 * Asserted through the app's own flow rather than by reading the manifest:
 * a bundle assertion proves the chunk exists, not that a person can still
 * type into it, and this sub-project's whole risk is trading a working
 * editor for a smaller number.
 */
test('a note opens and is typeable after the editor loads lazily', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('Typed after a lazy mount.');
  await expect(editor).toContainText('Typed after a lazy mount.');
});

test('the note list paints before the editor chunk has loaded', async ({ page }) => {
  // Hold the editor chunk indefinitely. The list must still appear: that is
  // the entire point of the split, and it is only observable while the chunk
  // is outstanding.
  await page.route('**/assets/NoteEditor-*.js', async () => {
    // never fulfilled
    await new Promise(() => {});
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify the second case fails**

Run: `lsof -ti:4173 | xargs -r kill -9; npx playwright test e2e/editorSplit.spec.ts`
Expected: the first test PASSES; the second FAILS or times out, because the
editor is still in the eager chunk and there is no `NoteEditor-*.js` to block.

- [ ] **Step 3: Make the mount lazy**

In `src/app/AppShell.tsx`, replace the plain import from Task 2 with:

```tsx
const NoteEditor = lazy(() =>
  import('@/features/notes/NoteEditor').then((module) => ({ default: module.NoteEditor })),
);
```

placed at module scope below the imports, and add `lazy` and `Suspense` to
the existing `from 'react'` import list.

Wrap the render site (currently `<NoteEditor key={selectedNote.id} … />`):

```tsx
                    <Suspense fallback={<EditorLoading />}>
                      <NoteEditor
                        key={selectedNote.id}
                        note={selectedNote}
                        seedText={seed?.id === selectedNote.id ? seed.text : undefined}
                        autoFocus={justCreatedId === selectedNote.id}
                        onActivateTag={handleActivateTag}
                        onActivateLink={handleActivateLink}
                        revealHeading={
                          reveal !== null && reveal.id === selectedNote.id
                            ? { text: reveal.text, nonce: reveal.nonce }
                            : undefined
                        }
                        onOpenNote={select}
                        exportRef={exportRef}
                        tagKeys={tagKeys}
                      />
                    </Suspense>
```

Keep the `key` on `NoteEditor`, not on `Suspense`: the comment above it
records that the key is load-bearing — it remounts the editor per note so an
instance only ever writes to one note, and its unmount cleanup is the
flush-on-switch.

- [ ] **Step 4: Add the fallback component**

Create `src/app/EditorLoading.tsx`:

```tsx
import type { ReactElement } from 'react';

import { useT } from '@/i18n';

/**
 * What the editor pane shows while its chunk is in flight.
 *
 * `null` was rejected: on a desktop the pane is visible from first paint, and
 * a pane that is blank and then fills in reads as a bug rather than as
 * loading. This is deliberately quiet — no spinner — because on a warm cache
 * it is on screen for a single frame, and a spinner that flashes for 16ms is
 * worse than a label that does not move.
 */
export function EditorLoading(): ReactElement {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-ui text-faint">{t('editor.loading')}</p>
    </div>
  );
}
```

Add the key to `src/i18n/en.ts`:

```ts
  'editor.loading': 'Opening the note…',
```

and to `src/i18n/ko.ts`:

```ts
  'editor.loading': '노트를 여는 중…',
```

Import `EditorLoading` in `AppShell.tsx`.

- [ ] **Step 5: Un-skip the sourceLint case from Task 2**

Change `it.skip(` back to `it(` for "lets only AppShell reach NoteEditor, and
only lazily", and delete the skip comment above it.
It passes now: `AppShell`'s only reference is `import(...)`, which the
regex — anchored on `^import…from` — does not match.

- [ ] **Step 6: Run the tests**

Run:

```bash
npx vitest run scripts/sourceLint.test.ts
lsof -ti:4173 | xargs -r kill -9; npx playwright test e2e/editorSplit.spec.ts
```

Expected: all PASS, including the blocked-chunk case.

- [ ] **Step 7: Measure**

Run the Task 1 Step 5 measurement command.
Expected: **~234,800 B**, down from 364,303. If it is within a few hundred
bytes of 364,303, a static edge survives — find it before continuing:

```bash
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('dist/.vite/manifest.json','utf8'));
const entry=Object.keys(m).find(k=>m[k].isEntry);
const seen=new Set(); const walk=k=>{if(seen.has(k))return;seen.add(k);(m[k].imports||[]).forEach(walk)};
walk(entry);
[...seen].forEach(k=>console.log(m[k].file, '<-', k));
"
```

- [ ] **Step 8: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9; npm run test:e2e
git add -A
git commit -m "perf(editor): mount the editor lazily, off the first-paint path"
```

---

### Task 4: Preload the editor once the shell has painted

This is the decision the user took on 2026-09-17: buy first paint, and hide
the cost. Without this, someone who opens the app to type waits for a
download that used to be already done.

**Files:**

- Create: `src/app/usePreloadEditor.ts`
- Modify: `src/app/AppShell.tsx`
- Test: `src/app/usePreloadEditor.test.ts`

**Interfaces:**

- Consumes: the lazy boundary from Task 3.
- Produces: `usePreloadEditor(): void` — call once, from `AppShell`'s body.

- [ ] **Step 1: Write the failing test**

Create `src/app/usePreloadEditor.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePreloadEditor } from './usePreloadEditor';

describe('usePreloadEditor', () => {
  it('requests the editor module exactly once, after an idle callback', async () => {
    const load = vi.fn(async () => undefined);
    const { rerender } = renderHook(() => usePreloadEditor(load));

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });

    rerender();
    rerender();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not reject when the preload fails', async () => {
    const load = vi.fn(async () => {
      throw new Error('offline');
    });
    // A rejected preload must not surface: the real mount will try again and
    // report properly. An unhandled rejection here would be a console error
    // on every offline load.
    renderHook(() => usePreloadEditor(load));
    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/usePreloadEditor.test.ts`
Expected: FAIL — "Failed to resolve import './usePreloadEditor'".

- [ ] **Step 3: Implement the hook**

Create `src/app/usePreloadEditor.ts`:

```ts
import { useEffect, useRef } from 'react';

/** The default loader: the same specifier `AppShell`'s `lazy` call uses, so
 * both resolve to one chunk and the preload genuinely warms the mount. */
const loadEditor = (): Promise<unknown> => import('@/features/notes/NoteEditor');

/**
 * Warms the editor chunk after the shell has painted.
 *
 * The split in this sub-project buys ~500 ms of first paint by taking the
 * editor off the critical path. Left there, it would hand part of that back
 * to anyone who opens the app to write: the chunk would start downloading
 * when the editor first rendered, rather than alongside the shell. This
 * fetches it in the gap the reader spends choosing a note.
 *
 * `requestIdleCallback` rather than an immediate effect, so the preload
 * cannot compete with the first paint it exists to protect. Safari has no
 * `requestIdleCallback`, so a `setTimeout` stands in — the exact delay does
 * not matter, only that it is after the current frame.
 *
 * The ref guard is not an optimisation: `AppShell` re-renders constantly
 * (every `useLiveQuery`, every selection), and an unguarded effect with no
 * deps still runs once, but a future edit adding a dep would turn this into
 * a fetch per render against a browser cache that may not coalesce.
 */
export function usePreloadEditor(load: () => Promise<unknown> = loadEditor): void {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = (): void => {
      // Swallowed deliberately: a failed preload is not a user-visible
      // event. The real mount repeats the import and reports through the
      // Suspense boundary if it genuinely cannot load.
      void load().catch(() => undefined);
    };

    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (typeof idle === 'function') {
      idle(run);
      return;
    }
    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [load]);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/usePreloadEditor.test.ts`
Expected: PASS, both cases.

If the first case times out, jsdom has no `requestIdleCallback` and the
`setTimeout` path is running — that is the intended fallback and `waitFor`
covers it. If it still fails, check that `vitest.setup.ts` has not acquired an
`requestIdleCallback` stub that never fires.

- [ ] **Step 5: Call it from `AppShell`**

In `src/app/AppShell.tsx`, inside the component body near the other hooks:

```ts
  // Warms the lazily-mounted editor chunk once the shell is up; see
  // `usePreloadEditor`. Called unconditionally — the hook guards itself.
  usePreloadEditor();
```

- [ ] **Step 6: Verify the preload does not re-block first paint**

```bash
lsof -ti:4173 | xargs -r kill -9; npm run measure:load
```

Expected: first note visible on 4x CPU / Slow 4G still **~1,979 ms**, NOT back
near 2,482 ms. If it regressed, the preload is racing the first paint — check
that `requestIdleCallback` is actually being used and that the effect is not
running during render.

- [ ] **Step 7: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9; npm run test:e2e
git add -A
git commit -m "perf(editor): preload the editor chunk once the shell has painted"
```

---

### Task 5: Prove the writer's path did not regress

The spec requires this and names it as the way this sub-project could ship a
good number and a worse experience. `measure:load` currently waits for the
note LIST; nothing measures time-to-typeable.

**Files:**

- Modify: `e2e/load.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 1-4.
- Produces: a second scenario in `docs/design/load.md` reporting
  "editor ready".

- [ ] **Step 1: Add the editor-ready measurement**

In `e2e/load.spec.ts`, inside the existing per-scenario test, after the
first-note wait, add a second wait and sample. Replace the timing block:

```ts
      const started = Date.now();
      await page.goto('/', { waitUntil: 'commit' });
      await page.getByRole('button', { name: /Note 0,/ }).waitFor();
      const firstNote = Date.now() - started;

      // The WRITER's path, which the split could regress while improving the
      // number above: the list appearing sooner is worth nothing to someone
      // who opened the app to type. Measured to the point the editor is
      // actually mounted, not merely requested.
      await page.getByRole('button', { name: /Note 0,/ }).click();
      await page.getByRole('textbox', { name: 'Note text' }).waitFor();
      const editorReady = Date.now() - started;

      samples.push({ ...(await readTimings(page)), firstNote, editorReady });
```

Add `editorReady: number` to the `Sample` interface, add `editorReady` to the
median calls and to the row template, and add an `Editor ready` column to the
table header in the `afterAll` writer.

- [ ] **Step 2: Measure on this branch**

```bash
lsof -ti:4173 | xargs -r kill -9; npm run measure:load
cat docs/design/load.md
```

Record the 4x / Slow 4G row.

- [ ] **Step 3: Measure the same thing on `main`**

```bash
git stash -u
lsof -ti:4173 | xargs -r kill -9; npm run measure:load
cat docs/design/load.md
git stash pop
```

`main` has no `editorReady` column, so this measures the branch's spec file
against `main`'s source — which is exactly what is wanted, and works because
`e2e/load.spec.ts` is stashed too. **If the stash removes the new column,
instead check out just that file:** `git stash`, then
`git checkout stash@{0} -- e2e/load.spec.ts`, measure, then restore.

- [ ] **Step 4: Compare and decide**

Expected: `firstNote` improves by ~500 ms; `editorReady` is within noise of
`main`, because the preload has the chunk in flight before the click.

**If `editorReady` regressed by more than ~150 ms on Slow 4G, STOP and report
it rather than proceeding.** The user bought first paint on the explicit
understanding that the writer's path would be protected by the preload; a
measured regression is a reason to revisit the decision, not to absorb.

- [ ] **Step 5: Commit**

```bash
git add e2e/load.spec.ts
git commit -m "test(harness): measure time-to-typeable, not just first paint"
```

---

### Task 6: Lower the ceiling to match

Decided by the user on 2026-09-17, in advance. A budget left at 368,000 after
a ~130 KB saving hands the whole win to the next six features without anyone
deciding to spend it.

**Files:**

- Modify: `scripts/bundleSize.test.ts`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: the finished closure measurement from Task 5.
- Produces: nothing later depends on it.

- [ ] **Step 1: Measure the finished branch**

Run the Task 1 Step 5 command. Call the result `MEASURED`.

- [ ] **Step 2: Set the new ceiling**

`CEILING_BYTES` becomes `MEASURED` rounded up to the next 1,000 plus 3,000 —
the same ~3 KB-for-wiring convention every raise used. For an expected
`MEASURED` of ~234,800 that is **238,000**. Use the real number, not this
estimate.

- [ ] **Step 3: Record it in the docblock**

Append a new section to `scripts/bundleSize.test.ts`'s docblock, in the same
voice as the entries above it. It must state: the measured before and after;
that this is the FIRST time the guard has moved DOWN; that the decision was
the user's, taken in advance on 2026-09-17 as part of approving the spec; and
that the outstanding audit named in the sixth-raise entry is now ANSWERED, so
a future reader does not go looking for it again.

- [ ] **Step 4: Update CLAUDE.md**

The bullet beginning "L3's `React.lazy` boundary around the relationship
graph" carries the current ceiling and the audit's status. Update the figure,
and replace the "audit is now sized and still outstanding" sentences with what
actually happened — 364,303 → `MEASURED`, and the barrel as the cause.

Also update the test counts in the Status section if they changed.

- [ ] **Step 5: Verify the guard bites**

Temporarily set `CEILING_BYTES` to `MEASURED - 1`, run
`npx vitest run scripts/bundleSize.test.ts`, confirm it FAILS, then restore.
A ceiling that cannot fail is not a guard.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format && npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9; npm run test:e2e
npm run measure:check
git add -A
git commit -m "chore: lower the eager-JS ceiling, for the first time"
```

---

## Verification before the branch is integrated

- [ ] `npm run measure:load` recorded on both sides, both columns.
- [ ] `npm run shots` — 272 files, counted, not trusted to the exit code.
- [ ] `npm run shots:mobile` — 4 files.
- [ ] `npm run measure:check` clean.
- [ ] Full `npm test` and `npm run test:e2e` three times on the merged result,
      at low machine load — the editor now mounts through a `Suspense`
      boundary, and `docs/rulings/notes-lifecycle.md` records several real
      races around `NoteEditor`'s seed and remount. **Read any failure there
      as a real race first**; the 2026-09-17 toolbar-focus bug is the
      cautionary example of a "flake" that was a genuine defect.
- [ ] Run the app (`npm run dev`) and open a note. `useSession`'s StrictMode
      bug is the recorded precedent for a class of defect no gate here can
      see.
