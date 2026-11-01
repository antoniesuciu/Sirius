import type { SqliteHandle } from '../runtime/sqlite.ts';
import { migrations } from './migrations.gen.ts';

/** Applies embedded migrations once each, in order, each in its own transaction. */
export function migrate(sqlite: SqliteHandle): void {
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at INTEGER)');
  const applied = new Set(
    sqlite.all<{ tag: string }>('SELECT tag FROM _migrations').map((r) => r.tag),
  );
  for (const { tag, sql } of migrations) {
    if (applied.has(tag)) continue;
    sqlite.exec('BEGIN');
    try {
      for (const statement of sql.split('--> statement-breakpoint')) sqlite.exec(statement);
      sqlite.exec(`INSERT INTO _migrations VALUES ('${tag}', ${Date.now()})`);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
