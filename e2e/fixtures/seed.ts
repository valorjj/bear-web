import type { Page } from '@playwright/test';

import type { Corpus } from './corpus.ts';

/**
 * Writes a corpus straight into IndexedDB *before the app boots*, via an init
 * script.
 *
 * The ordering is the whole design. Dexie's `liveQuery` observes writes made
 * through Dexie's own connection; raw IndexedDB writes from a second connection
 * in the same page are invisible to it, so a note inserted after boot would sit
 * in the database and never appear in the list. Seeding in an init script means
 * the stores are already populated by the time Dexie opens them, and no
 * observability is involved at all.
 *
 * Two consequences worth knowing:
 *
 * - The stores are created here by hand, and their names, key paths and index
 *   names must match `src/data/db.ts` exactly. Dexie compares its declared
 *   schema against the one it finds and throws `SchemaError` on a mismatch, so
 *   a drift fails loudly on the first shot rather than silently.
 * - **The IndexedDB version is Dexie's version times ten.** Dexie's
 *   `version(2)` (added in b1 for fold state) is IndexedDB version 20, not 2.
 *   Seeding at the wrong number leaves Dexie wanting to upgrade further while
 *   this script still holds a connection open, which blocks the upgrade
 *   forever: `openDatabase` never settles, so `main.tsx` never calls
 *   `createRoot` and the page stays a blank `#root` with one console warning
 *   as the only clue. That is also why the connection is closed as soon as
 *   the seed transaction completes.
 * - `noteTags` is created empty and the `tagIndexVersion` marker is never
 *   written, so the app's own startup rebuild fills the tag index from
 *   `notes.text`. The sidebar tree in every screenshot is therefore produced by
 *   the real parser.
 *
 * Seeding happens only when the database does not yet exist (`onupgradeneeded`
 * fires). A reload re-runs the init script but finds the database already at
 * version 1, so edits made during a session survive it.
 */
export async function seedDatabase(page: Page, corpus: Corpus): Promise<void> {
  await page.addInitScript((data: Corpus) => {
    // Mirrors `src/data/db.ts`'s `version(1)` and `version(2)` stores
    // together; 20 is how Dexie encodes version 2. See the docblock.
    const request = indexedDB.open('bear-web', 20);

    request.onupgradeneeded = () => {
      const database = request.result;

      const notes = database.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('updatedAt', 'updatedAt');
      notes.createIndex('createdAt', 'createdAt');
      notes.createIndex('trashedAt', 'trashedAt');

      const noteTags = database.createObjectStore('noteTags', {
        keyPath: ['noteId', 'tag'],
      });
      noteTags.createIndex('noteId', 'noteId');
      noteTags.createIndex('tag', 'tag');

      const tags = database.createObjectStore('tags', { keyPath: 'tag' });
      tags.createIndex('sortOrder', 'sortOrder');

      const files = database.createObjectStore('files', { keyPath: 'id' });
      files.createIndex('noteId', 'noteId');

      const settings = database.createObjectStore('settings', { keyPath: 'key' });

      // Added at version 2. Created empty here, exactly as Dexie would: fold
      // state is view state, not part of the seeded corpus.
      database.createObjectStore('noteFolds', { keyPath: 'noteId' });

      for (const note of data.notes) notes.put(note);
      for (const setting of data.settings) settings.put(setting);
    };

    // Held open, this connection blocks any later upgrade — including a
    // future Dexie version 3.
    request.onsuccess = () => request.result.close();
  }, corpus);
}
