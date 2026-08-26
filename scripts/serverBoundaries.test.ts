import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
/**
 * Derived from the migrations, never hardcoded.
 *
 * A hardcoded `['sessions', 'identities']` was blind to every table D2 has not
 * created yet: `SELECT * FROM notes WHERE trashed_at IS NULL` passed the whole
 * guard. Reading the `CREATE TABLE` bodies means a new user-scoped table is
 * covered the moment the migration lands, and cannot be forgotten by whoever
 * writes the repository for it.
 */
function deriveUserScopedTables(dir = join('server', 'migrations')): string[] {
  const sql = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');

  const tables = new Set<string>();
  for (const match of sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\s*\)/gi,
  )) {
    const [, name, body] = match;
    // A `user_id` COLUMN, i.e. one at the start of a definition line — not a
    // mention inside a KEY or CONSTRAINT clause.
    if (/^\s*`?user_id`?\s+\w/im.test(body!)) tables.add(name!);
  }
  return [...tables];
}

const USER_SCOPED_TABLES: readonly string[] = deriveUserScopedTables();

/**
 * One definition, used by the real assertion and by the falsification tests
 * alike. A second copy of this regex is how a guard and its own proof drift
 * apart without either failing.
 */
function namesTable(tables: readonly string[], line: string): boolean {
  return tables.some((table) =>
    new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(line),
  );
}

function namesUserScopedTable(line: string): boolean {
  return namesTable(USER_SCOPED_TABLES, line);
}

/**
 * A bare mention of `user_id` is not enough: `SELECT user_id FROM identities
 * WHERE email = ?` contains the string `user_id` while reading it, not
 * filtering by it, and is exactly the cross-user leak this guard exists to
 * reject. `INSERT INTO` is the one shape where naming the column is
 * correct — the value is being supplied, not filtered — so a bare mention
 * stays acceptable there. Every other shape (`FROM`, `UPDATE`, `JOIN`)
 * requires `user_id` in predicate position: followed by `=` or by `IN`.
 *
 * The modifiers between `INSERT` and `INTO` are matched too. K2's
 * `INSERT IGNORE INTO image_files` is a legitimate insert that this rejected
 * while accepting the identical statement without the modifier — a gap in the
 * guard rather than a fault in the SQL, and annotating around it would have
 * hidden the gap instead of closing it. `IGNORE`, `LOW_PRIORITY`,
 * `DELAYED` and `HIGH_PRIORITY` are MySQL's full set here.
 */
function constrainsUserId(line: string): boolean {
  if (/\bINSERT\s+(?:\w+\s+)*INTO\b/i.test(line) && /user_id/.test(line)) return true;
  return /user_id\s*(=|IN\b)/i.test(line);
}

function isAnnotated(previousLine: string, line: string): boolean {
  const context = `${previousLine}\n${line}`;
  return /tenancy-ok:/.test(context);
}

describe('multi-tenancy guard', () => {
  it('derives its table list from the migrations', () => {
    // Guards the guard, the same way the file walk above does: a regex that
    // stopped matching, or a moved migrations directory, would empty this list
    // and make every assertion below vacuously true with nothing to see.
    expect(USER_SCOPED_TABLES.length, 'no user-scoped table was derived').toBeGreaterThan(0);
    expect(USER_SCOPED_TABLES).toContain('sessions');
    expect(USER_SCOPED_TABLES).toContain('identities');
    // `users` is keyed by `id`, not `user_id`: it must NOT be derived, or every
    // legitimate user-creation statement would need an annotation.
    expect(USER_SCOPED_TABLES).not.toContain('users');
  });

  it('covers a user-scoped table the moment its migration exists', () => {
    // The D2 case, proven without waiting for D2: a table that exists only in
    // this fixture is picked up, so `SELECT * FROM notes WHERE trashed_at IS
    // NULL` — which passed the whole guard while the list was hardcoded — is
    // now an offender.
    const dir = mkdtempSync(join(tmpdir(), 'tenancy-'));
    writeFileSync(
      join(dir, '002_notes.sql'),
      `CREATE TABLE notes (
         id         CHAR(36) NOT NULL PRIMARY KEY,
         user_id    CHAR(36) NOT NULL,
         trashed_at BIGINT   NULL,
         KEY idx_notes_user (user_id)
       ) ENGINE=InnoDB;`,
    );

    const derived = deriveUserScopedTables(dir);
    expect(derived).toEqual(['notes']);

    const leak = 'const sql = `SELECT * FROM notes WHERE trashed_at IS NULL`;';
    expect(namesTable(derived, leak)).toBe(true);
    expect(constrainsUserId(leak)).toBe(false);
    expect(isAnnotated('', leak)).toBe(false);

    // And the same statement, properly scoped, is accepted.
    expect(constrainsUserId('SELECT * FROM notes WHERE user_id = ? AND trashed_at IS NULL')).toBe(
      true,
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it('constrains user_id in every statement touching a user-scoped table', () => {
    const offenders = sources.flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n');

      return lines.flatMap((line, index) => {
        if (!namesUserScopedTable(line)) return [];
        if (constrainsUserId(line)) return [];
        if (isAnnotated(lines[index - 1] ?? '', line)) return [];

        return [`${path}:${index + 1}  ${line.trim()}`];
      });
    });

    expect(offenders, 'add `user_id = ?` or an explicit `/* tenancy-ok: reason */`').toEqual([]);
  });

  it('fails on an unscoped statement', () => {
    // Falsification. The guard above passes trivially while no SQL exists at
    // all, so prove the predicate rejects the thing it claims to reject.
    const unscoped = 'const sql = `SELECT * FROM sessions WHERE created_at > ?`;';

    expect(namesUserScopedTable(unscoped)).toBe(true);
    expect(constrainsUserId(unscoped)).toBe(false);
    expect(isAnnotated('', unscoped)).toBe(false);

    // The annotation escape hatch must also work: the same line with a tenancy-ok
    // comment should pass.
    const annotated =
      '/* tenancy-ok: expiring old sessions by time */ const sql = `SELECT * FROM sessions WHERE created_at > ?`;';
    expect(namesUserScopedTable(annotated)).toBe(true);
    expect(isAnnotated('', annotated)).toBe(true);
  });

  it('rejects a bare mention of user_id but accepts it as a predicate', () => {
    // The exact shape task 5's Step 5 injection produced: reading user_id
    // while filtering by something else entirely. This must be rejected.
    const readsWithoutFiltering = 'SELECT user_id FROM identities WHERE email = ?';
    expect(namesUserScopedTable(readsWithoutFiltering)).toBe(true);
    expect(constrainsUserId(readsWithoutFiltering)).toBe(false);

    // The mirror image: filtering by user_id while selecting something else
    // must be accepted.
    const filtersByUserId = 'SELECT email FROM identities WHERE user_id = ?';
    expect(namesUserScopedTable(filtersByUserId)).toBe(true);
    expect(constrainsUserId(filtersByUserId)).toBe(true);
  });
});
