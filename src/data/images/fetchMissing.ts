import { files } from '../repositories';
import { hasSignedInBefore } from '../sync/config';
import { createTransport, type Transport } from '../sync/transport';

export interface LoadImageDeps {
  transport?: Pick<Transport, 'downloadImage'>;
  signedIn?: () => boolean;
  now?: () => number;
}

/**
 * One image's bytes: from this device if it has them, from the server if not.
 *
 * This is what K1 left the door open for. `acquireObjectUrl` deliberately does
 * not cache a miss — its comment says "the bytes can arrive later (K2)" — and
 * this is that later.
 *
 * Lazy rather than eager, deliberately: pulling every image an account has
 * ever stored onto a phone costs real data and storage for pictures the user
 * may never look at. The cost is that a note never opened while online shows
 * placeholders offline.
 *
 * Four outcomes, and the differences between them matter:
 *
 * - **Stored locally** → returned, no request at all.
 * - **Signed out** → `null`, and NO request. A visitor who never signed in
 *   must make no cross-origin call, the same rule the boot `GET /me` gate
 *   exists for.
 * - **Server says 404** → `null`. Not an error: the owning device may not
 *   have uploaded it yet.
 * - **Network or server failure** → `null`, and NOTHING is remembered. The
 *   next attempt tries again, which is the whole reason `acquireObjectUrl`
 *   does not cache a miss.
 */
export async function loadImageBlob(id: string, deps: LoadImageDeps = {}): Promise<Blob | null> {
  const local = await files.get(id);
  if (local !== undefined) return local.blob;

  const signedIn = deps.signedIn ?? hasSignedInBefore;
  if (!signedIn()) return null;

  const transport = deps.transport ?? createTransport();

  let blob: Blob | null;
  try {
    blob = await transport.downloadImage(id);
  } catch {
    // Offline, or the server is down. Deliberately swallowed and NOT recorded:
    // the caller shows the placeholder it is already showing, and the next
    // attempt retries.
    return null;
  }

  if (blob === null) return null;

  // Stored, so the next read is local and no second device round trip
  // happens for an image the user scrolls past twice.
  //
  // `noteId` is deliberately empty: this device does not know which note asked
  // for it, and inventing one would put a wrong value into the row that the
  // boot sweep reads. An empty owner means the sweep treats it as belonging to
  // no note — which is correct, because nothing here established ownership.
  await files.addDownloaded(id, blob, deps.now?.() ?? Date.now());

  return blob;
}
