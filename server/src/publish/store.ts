import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The only id shape that may reach a path join.
 *
 * Identical to `server/src/images/store.ts`'s, and for the same reason: both
 * the page id and the user id arrive from a URL segment or a session, so
 * without this a `../` walks straight out of the volume. Excluding `.` and
 * `/` from the class makes traversal unrepresentable rather than filtered.
 */
const ID = /^[A-Za-z0-9_-]+$/;

function assertSafe(part: string, what: string): void {
  if (!ID.test(part)) throw new Error(`unsafe ${what}: ${JSON.stringify(part)}`);
}

export function pagePath(root: string, userId: string, id: string): string {
  assertSafe(userId, 'user id');
  assertSafe(id, 'page id');
  return join(root, userId, `${id}.html`);
}

export async function writePage(
  root: string,
  userId: string,
  id: string,
  html: string,
): Promise<void> {
  const path = pagePath(root, userId, id);
  await mkdir(join(root, userId), { recursive: true });
  await writeFile(path, html, 'utf8');
}

/**
 * The document, or `null` when it is not on disk.
 *
 * A row can exist without its file: the two are not written atomically, so a
 * crash between them leaves exactly that. The caller turns `null` into a 404
 * rather than a 500.
 *
 * Only `ENOENT` becomes `null`. Every other error propagates, because "the
 * disk is broken" is not "the file is absent", and silently 404ing a
 * permissions failure would present as a page that vanished for no reason.
 */
export async function readPage(root: string, userId: string, id: string): Promise<string | null> {
  try {
    return await readFile(pagePath(root, userId, id), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** `force: true` so unpublishing a page whose file is already gone succeeds —
 * the row is the record, and a delete that fails on a missing file would strand
 * it. */
export async function removePage(root: string, userId: string, id: string): Promise<void> {
  await rm(pagePath(root, userId, id), { force: true });
}

/**
 * Removes every page an account owns.
 *
 * Called from `DELETE /account`, because the database cascade cannot reach the
 * filesystem — and a cascade that leaves published pages readable on the
 * internet is not a deletion.
 */
export async function removeUserPages(root: string, userId: string): Promise<void> {
  assertSafe(userId, 'user id');
  await rm(join(root, userId), { recursive: true, force: true });
}
