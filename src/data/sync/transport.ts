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
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
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
  };
}
