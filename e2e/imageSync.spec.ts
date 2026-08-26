import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';

import { seedDatabase } from './fixtures/seed.ts';

/**
 * K2's end-to-end proof, and its limits are worth stating plainly.
 *
 * `playwright.config.ts` starts only the app's own preview server, so this —
 * like `e2e/sync.spec.ts` — cannot reach the real API. The server is a route
 * handler backed by a `Map` shared between two browser contexts.
 *
 * **What that proves:** the CLIENT contract end to end. Pasting stores and
 * queues; the engine uploads; a second device with the same note text but no
 * bytes asks for them, stores what arrives, and renders a real image.
 *
 * **What it does not prove:** that the real `PUT`/`GET /files/:id` behave the
 * way this fake does. That is what `server/src/routes/files.test.ts` is for,
 * against a real MariaDB and a real filesystem — and the two halves meeting
 * on real hardware is a check only a person with two devices can make.
 */
const PROD_API = 'https://api.markflowing.com';
const DEV_API = 'http://localhost:8787';
const SESSION_HINT_KEY = 'bear-web:account:hasSession';

const corsHeaders = {
  'access-control-allow-origin': 'http://localhost:4173',
  'access-control-allow-credentials': 'true',
};

/** The bytes both contexts share, standing in for the Mac Mini's disk. */
type Disk = Map<string, Buffer>;

async function serveApi(context: BrowserContext, disk: Disk, uploads: string[]): Promise<void> {
  for (const origin of [PROD_API, DEV_API]) {
    await context.route(`${origin}/me`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ userId: 'u1', email: 'two-devices@example.com' }),
      }),
    );

    await context.route(`${origin}/sync**`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          notes: [],
          tags: [],
          rev: 0,
          accepted: [],
          conflicts: { notes: [], tags: [] },
        }),
      }),
    );

    await context.route(`${origin}/files/*`, (route: Route) => {
      const id = new URL(route.request().url()).pathname.split('/').pop()!;

      if (route.request().method() === 'PUT') {
        const body = route.request().postDataBuffer();
        if (body !== null) disk.set(id, body);
        uploads.push(id);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ ok: true }),
        });
      }

      const bytes = disk.get(id);
      if (bytes === undefined) {
        return route.fulfill({ status: 404, headers: corsHeaders, body: '' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'image/webp',
        headers: corsHeaders,
        body: bytes,
      });
    });
  }
}

async function signedIn(context: BrowserContext): Promise<void> {
  await context.addInitScript((key: string) => {
    localStorage.setItem(key, '1');
  }, SESSION_HINT_KEY);
}

/** Pastes a real PNG, which the app downscales and re-encodes to a real WebP. */
async function pasteImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 30;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = '#3366cc';
    context.fillRect(0, 0, 60, 30);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/png'),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], 'shot.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
}

/** The note's Markdown, read straight out of IndexedDB. */
async function noteText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const open = indexedDB.open('bear-web');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise<{ text: string }[]>((resolve) => {
      const request = database.transaction('notes').objectStore('notes').getAll();
      request.onsuccess = () => resolve(request.result as { text: string }[]);
    });
    database.close();
    return rows.map((row) => row.text).join('\n');
  });
}

test('an image pasted on one device is fetched by another', async ({ browser }) => {
  // Two full browser contexts, two app boots, and a 2s edit debounce before
  // the engine syncs at all. The default 30s budget is not enough for a test
  // that legitimately waits on the app's own cadence twice.
  test.setTimeout(120_000);

  const disk: Disk = new Map();
  const uploads: string[] = [];

  const deviceA = await browser.newContext();
  await signedIn(deviceA);
  await serveApi(deviceA, disk, uploads);
  const a = await deviceA.newPage();

  await a.goto('/');
  await a.getByRole('button', { name: 'New note' }).click();
  const editor = a.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Shared screenshot');
  await pasteImage(a);
  await expect(a.locator('.ProseMirror img.bear-stored-image')).toHaveAttribute('src', /^blob:/);
  await editor.blur();

  // The upload is the engine's, not the paste's, so it is polled rather than
  // awaited on any single action.
  await expect.poll(() => uploads.length, { timeout: 15000 }).toBeGreaterThan(0);

  const text = await noteText(a);
  const match = /!\[\]\((files\/[A-Za-z0-9_-]+\.webp)\)/.exec(text);
  expect(match, 'device A wrote no stored-image reference').not.toBeNull();

  // Device B: the same note text, and NONE of the bytes. Exactly the state a
  // second device is in after pulling a note whose image it has never seen.
  const deviceB = await browser.newContext();
  await signedIn(deviceB);
  await serveApi(deviceB, disk, uploads);
  const b = await deviceB.newPage();

  // Through the maintained fixture rather than a hand-rolled init script: it
  // already knows the store list and — critically — the IndexedDB version,
  // which is Dexie's times ten. A first attempt duplicated that here, got it
  // subtly wrong, and the note simply never appeared.
  await seedDatabase(b, {
    notes: [
      {
        id: 'shared',
        title: 'Shared screenshot',
        text,
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      },
    ],
    settings: [],
  });

  await b.goto('/');

  // Device B boots signed in WITH local notes, so the app asks whether to add
  // them to the account — real behaviour, and its backdrop intercepts every
  // click until answered. "Add them" is what a user with one account on two
  // devices means. Without this the row is found, is visible, and is
  // unclickable, which reads as an unstable element rather than a modal.
  // Awaited, not probed with `isVisible()`: the dialog appears only once the
  // session has resolved, so an immediate check finds nothing and the click
  // below then fails on an intercepted pointer — which reads as an unstable
  // element rather than as a modal nobody answered. It is deterministic here:
  // a signed-in device with local notes always gets asked.
  await b.getByRole('button', { name: 'Add them' }).click();

  await b.getByRole('button', { name: /Shared screenshot/ }).click();

  const image = b.locator('.ProseMirror img.bear-stored-image');
  await expect(image).toHaveAttribute('src', /^blob:/, { timeout: 15000 });
  // The BYTES, not just the element: a placeholder or a broken image would
  // still satisfy everything above.
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15000 })
    .toBeGreaterThan(0);

  await deviceA.close();
  await deviceB.close();
});
