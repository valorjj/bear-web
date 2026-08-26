import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The only id shape that may reach a path join.
 *
 * Identical to the pattern `src/data/images/storedImagePath.ts` enforces on
 * the client, and the reason is not symmetry: the id arrives from a URL
 * segment, so without this a `../` walks straight out of the volume. Excluding
 * `.` and `/` from the class is what makes traversal unrepresentable rather
 * than merely filtered.
 */
const ID = /^[A-Za-z0-9_-]+$/;

function assertSafe(part: string, what: string): void {
  if (!ID.test(part)) throw new Error(`unsafe ${what}: ${JSON.stringify(part)}`);
}

/**
 * Where one account's image lives on disk.
 *
 * Throws rather than sanitising. A sanitised path is a guess about what the
 * caller meant; a refusal is the only answer that cannot be wrong, and every
 * caller of this already has a 400 to return.
 */
export function imagePath(root: string, userId: string, id: string): string {
  assertSafe(userId, 'user id');
  assertSafe(id, 'image id');
  return join(root, userId, `${id}.webp`);
}

export async function writeImage(
  root: string,
  userId: string,
  id: string,
  bytes: Uint8Array,
): Promise<void> {
  const path = imagePath(root, userId, id);
  await mkdir(join(root, userId), { recursive: true });
  await writeFile(path, bytes);
}

/**
 * The bytes, or `null` when they are not on disk.
 *
 * A row can exist without its file: the two are not written atomically, so a
 * crash between them leaves exactly that. The caller turns `null` into a 404
 * rather than a 500 — the client's answer to both is the same placeholder.
 *
 * Only `ENOENT` becomes `null`. Every other error propagates, because "the
 * disk is broken" is not "the file is absent" and silently returning `null`
 * for a permissions failure would present as a missing image forever.
 */
export async function readImage(
  root: string,
  userId: string,
  id: string,
): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(imagePath(root, userId, id)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Removes every image an account owns.
 *
 * Called from `DELETE /account`, because the database cascade cannot reach the
 * filesystem — and a cascade that leaves the pixels behind is not a deletion.
 * `force: true` so deleting an account that never stored an image is a no-op
 * rather than an error.
 */
export async function removeUserImages(root: string, userId: string): Promise<void> {
  assertSafe(userId, 'user id');
  await rm(join(root, userId), { recursive: true, force: true });
}
