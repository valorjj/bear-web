import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function walk(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    return extensions.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

const sources = walk('server', ['.ts']).filter((path) => !/\.test\.ts$/.test(path));

describe('server boundaries', () => {
  it('scans a non-trivial number of files', () => {
    // Guards the guard. A typo'd directory name would make every assertion
    // below vacuously true, which is the exact failure sourceLint.test.ts
    // documents for its own boundary walk.
    expect(sources.length, 'server/ looks empty').toBeGreaterThan(1);
  });

  it('reaches only src/data/types.ts under src/', () => {
    const offenders = sources.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return [...source.matchAll(/from\s+'([^']+)'/g)]
        .map((match) => match[1]!)
        .filter((specifier) => specifier.includes('src/'))
        .filter((specifier) => !specifier.endsWith('src/data/types.ts'))
        .map((specifier) => `${path} imports ${specifier}`);
    });

    expect(offenders, 'the server shares types with the client and nothing else').toEqual([]);
  });

  it('has no DOM reference', () => {
    const offenders = sources.filter((path) =>
      /\b(document|window|localStorage)\./.test(readFileSync(path, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * The multi-tenancy guard.
 *
 * In a multi-tenant app one forgotten `WHERE user_id = ?` is a cross-user
 * notes leak, and that is not a class of bug to catch by review. Every SQL
 * statement naming a user-scoped table must either constrain `user_id` or
 * carry an explicit `tenancy-ok` annotation saying why it does not.
 *
 * The escape hatch is deliberate: some statements are legitimately unscoped
 * (creating a user, looking up an identity to FIND the user, expiring sessions
 * by time). Forcing them to lie about a `user_id` predicate would be worse
 * than making the exception visible and reviewable.
 */
const USER_SCOPED_TABLES = ['sessions', 'identities'] as const;

describe('multi-tenancy guard', () => {
  it('constrains user_id in every statement touching a user-scoped table', () => {
    const offenders = sources.flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n');

      return lines.flatMap((line, index) => {
        const names = USER_SCOPED_TABLES.some((table) =>
          new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(line),
        );
        if (!names) return [];
        if (/user_id/.test(line)) return [];

        // The annotation may sit on the statement's line or the line above it,
        // because a multi-line template literal often has no room on its own.
        const context = `${lines[index - 1] ?? ''}\n${line}`;
        if (/tenancy-ok:/.test(context)) return [];

        return [`${path}:${index + 1}  ${line.trim()}`];
      });
    });

    expect(offenders, 'add `user_id = ?` or an explicit `/* tenancy-ok: reason */`').toEqual([]);
  });

  it('fails on an unscoped statement', () => {
    // Falsification. The guard above passes trivially while no SQL exists at
    // all, so prove the predicate rejects the thing it claims to reject.
    const line = 'const sql = `SELECT * FROM sessions WHERE created_at > ?`;';

    const names = USER_SCOPED_TABLES.some((table) =>
      new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(line),
    );

    expect(names).toBe(true);
    expect(/user_id/.test(line)).toBe(false);
  });
});
