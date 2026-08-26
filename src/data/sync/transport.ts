import { API_ORIGIN } from './config';

export interface RemoteNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
  archivedAt: number | null;
  deleted: boolean;
  rev: number;
}

export interface RemoteTag {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
  deleted: boolean;
  rev: number;
}

export type PushNote = Omit<RemoteNote, 'rev'> & { baseRev: number };
export type PushTag = Omit<RemoteTag, 'rev'> & { baseRev: number };

export interface PullResponse {
  notes: RemoteNote[];
  tags: RemoteTag[];
  rev: number;
}

export interface PushResponse {
  accepted: Array<{ id: string; kind: 'note' | 'tag' }>;
  conflicts: { notes: RemoteNote[]; tags: RemoteTag[] };
  rev: number;
}

/** The server could not be reached, or answered in a way nothing can act on. */
export class SyncUnavailableError extends Error {}

/** The server answered 401. The session is gone; sync must stop, not retry. */
export class SyncUnauthorizedError extends Error {}

/**
 * The server answered 413 with `{ error: 'quota', used, limit }`.
 *
 * `used` and `limit` are declared and assigned in the constructor body rather
 * than as parameter properties — `erasableSyntaxOnly` forbids parameter
 * properties, so this class must spell them out explicitly.
 */
export class SyncQuotaError extends Error {
  readonly used: number;
  readonly limit: number;

  constructor(used: number, limit: number) {
    super(`quota exceeded: ${used} of ${limit} bytes`);
    this.used = used;
    this.limit = limit;
  }
}

export interface Transport {
  pull(since: number): Promise<PullResponse>;
  push(batch: { notes: PushNote[]; tags: PushTag[] }): Promise<PushResponse>;
  /** Stores one image's bytes. Throws `SyncQuotaError` when the account is full. */
  uploadImage(id: string, noteId: string, blob: Blob, width: number, height: number): Promise<void>;
  /**
   * One image's bytes, or `null` when the server does not have it.
   *
   * `null` rather than a throw for a 404, because that is not an error: it is
   * an image whose owner never uploaded it, or uploaded it from a device that
   * has not synced yet. Every other failure still throws, so the caller can
   * tell "not there" from "could not ask".
   */
  downloadImage(id: string): Promise<Blob | null>;
}

/**
 * The engine's only door to the network.
 *
 * `doFetch` is injected so the engine's tests drive a fake rather than a
 * server: a sync engine tested against a real HTTP round trip is a sync engine
 * tested once, slowly, and never at its failure paths.
 *
 * Every non-OK status becomes a typed error. A `500` returning an empty pull
 * would look exactly like "nothing changed", and the client would advance its
 * cursor past changes it never received.
 */
export function createTransport(
  origin: string = API_ORIGIN,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Transport {
  /**
   * Sends the request and turns every failure status into a typed error.
   *
   * Split from `call` below so the binary routes share the status mapping
   * without also inheriting `response.json()` — an image response is bytes,
   * and parsing it as JSON would throw on success.
   */
  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${origin}${path}`, { ...init, credentials: 'include' });
    } catch (cause) {
      throw new SyncUnavailableError(`cannot reach ${origin}`, { cause });
    }

    if (response.status === 401) throw new SyncUnauthorizedError('session is gone');

    if (response.status === 413) {
      const body = (await response.json()) as { used?: number; limit?: number };
      throw new SyncQuotaError(body.used ?? 0, body.limit ?? 0);
    }

    return response;
  }

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await send(path, init);
    if (!response.ok) throw new SyncUnavailableError(`${path} returned ${response.status}`);
    return response.json();
  }

  return {
    async pull(since) {
      return (await call(`/sync?since=${since}`)) as PullResponse;
    },
    async push(batch) {
      return (await call('/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      })) as PushResponse;
    },

    async uploadImage(id, noteId, blob, width, height) {
      const response = await send(`/files/${id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'image/webp',
          'x-note-id': noteId,
          'x-width': String(width),
          'x-height': String(height),
        },
        body: blob,
      });

      if (!response.ok)
        throw new SyncUnavailableError(`upload of ${id} returned ${response.status}`);
    },

    async downloadImage(id) {
      const response = await send(`/files/${id}`);

      // NOT an error. The bytes may simply not have been uploaded yet — by a
      // device that has been offline, or one that hit its quota — and the
      // caller's answer is the placeholder it is already showing.
      if (response.status === 404) return null;

      if (!response.ok) {
        throw new SyncUnavailableError(`download of ${id} returned ${response.status}`);
      }

      return response.blob();
    },
  };
}
