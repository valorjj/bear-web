import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import { readEnv } from './env.ts';

const ENV = {
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:8787',
  DATABASE_URL: 'mysql://root:root@127.0.0.1:3308/markflowing',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
};

function app() {
  return createApp({
    env: readEnv(ENV),
    query: async () => [],
    transaction: async (run) => run(async () => []),
    fetch: globalThis.fetch,
    secureCookies: false,
  });
}

describe('readEnv', () => {
  it('reads every required key', () => {
    expect(readEnv(ENV).appOrigin).toBe('http://localhost:5173');
  });

  it('names the missing key rather than failing later', () => {
    // A server that boots without GOOGLE_CLIENT_SECRET fails at the first
    // login attempt with an opaque provider error. Failing at boot with the
    // key's name is the difference between a five-second fix and an hour.
    expect(() => readEnv({ ...ENV, GOOGLE_CLIENT_SECRET: undefined })).toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
  });
});

describe('health', () => {
  it('reports ok', async () => {
    const response = await app().request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('the node environment', () => {
  it('has no DOM', () => {
    // Guards the project split itself. If the server suite ever inherits the
    // app project's jsdom environment, this passes silently becoming a lie
    // about what these tests prove — so assert the absence directly.
    expect(globalThis).not.toHaveProperty('document');
  });
});
