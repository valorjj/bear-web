import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards the fix for the incident this file exists to prevent: the
 * integration suite's `DELETE FROM users` (see `users.test.ts`) ran against
 * the SAME database a developer was signed into, deleting a real account
 * with no warning. `DATABASE_URL` (the app's real, persistent database) and
 * `TEST_DATABASE_URL` (truncated on every test run) must never name the same
 * database.
 *
 * Neither variable is guaranteed to be a live process.env value when this
 * file runs — a plain local `npm test` typically exports neither (they come
 * from `server/.env`, which nothing loads for `vitest`), and CI sets only
 * `TEST_DATABASE_URL`. To stay meaningful in exactly that common case, each
 * variable falls back to the checked-in config that would otherwise carry
 * it: `server/.env` (gitignored, present on a real dev machine) and then
 * `server/.env.example` (always present). That gives this test a real value
 * for both sides of the comparison in every environment it runs in, instead
 * of skipping — a skip here would pass vacuously on exactly the machine
 * where the collision matters most.
 */

function readEnvFile(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const prefix = `${key}=`;
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(prefix));
  const value = line?.slice(prefix.length).trim();
  return value === undefined || value === '' ? undefined : value;
}

function resolveUrl(key: string): string | undefined {
  return (
    process.env[key] ??
    readEnvFile(join('server', '.env'), key) ??
    readEnvFile(join('server', '.env.example'), key)
  );
}

/** The identity that actually matters: which server, which database. */
function databaseIdentity(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port}${parsed.pathname}`;
}

describe('the dev and test databases are never the same database', () => {
  it('detects a collision (the failure mode this guard exists to catch)', () => {
    // A same-server, same-name collision, exercised directly against the
    // comparator so this assertion does not depend on any environment
    // variable being set a particular way.
    const a = databaseIdentity('mysql://root:root@127.0.0.1:3308/markflowing');
    const b = databaseIdentity('mysql://markflowing:markflowing@127.0.0.1:3308/markflowing');
    expect(a).toBe(b);
  });

  it('DATABASE_URL and TEST_DATABASE_URL resolve to different databases', () => {
    const dbUrl = resolveUrl('DATABASE_URL');
    const testUrl = resolveUrl('TEST_DATABASE_URL');

    expect(
      dbUrl,
      'no DATABASE_URL found in process.env, server/.env, or server/.env.example',
    ).toBeTruthy();
    expect(
      testUrl,
      'no TEST_DATABASE_URL found in process.env, server/.env, or server/.env.example',
    ).toBeTruthy();

    expect(
      databaseIdentity(testUrl!),
      'TEST_DATABASE_URL must never name the same database as DATABASE_URL: ' +
        'the integration suite truncates it on every run',
    ).not.toBe(databaseIdentity(dbUrl!));
  });
});
