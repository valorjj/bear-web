import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { Query } from '../app.ts';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Applies numbered `.sql` files in name order, recording each in
 * `schema_migrations`.
 *
 * No ORM and no migration library: the data model is four tables, and a
 * dependency to manage four tables is more machinery than the thing it
 * manages. Statements are split on `;` at end of line, which is sufficient
 * because these files contain no stored procedures — if one ever does, this
 * splitter must be replaced rather than worked around.
 */
export async function migrate(query: Query, dir: string = DEFAULT_DIR): Promise<string[]> {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at BIGINT       NOT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  const applied = new Set(
    ((await query('SELECT name FROM schema_migrations')) as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  const pending = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name));

  for (const name of pending) {
    const statements = readFileSync(join(dir, name), 'utf8')
      .split(/;\s*$/m)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) await query(statement);

    await query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [
      name,
      Date.now(),
    ]);
  }

  return pending;
}

// Run directly by `npm run server:migrate`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createPool } = await import('./pool.ts');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('missing env: DATABASE_URL');

  const pool = createPool(url);
  const names = await migrate(pool.query);
  console.log(names.length > 0 ? `applied: ${names.join(', ')}` : 'already current');
  await pool.end();
}
