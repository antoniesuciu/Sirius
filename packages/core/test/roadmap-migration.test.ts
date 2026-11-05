import { expect, test } from 'vitest';
import { migrate } from '../src/db/migrate.ts';
import { migrations } from '../src/db/migrations.gen.ts';
import { openSqlite } from '../src/runtime/sqlite.ts';

test('existing roadmap steps gain empty descriptions and notes without losing progress', () => {
  const sqlite = openSqlite(':memory:');
  try {
    sqlite.exec('CREATE TABLE _migrations (tag TEXT PRIMARY KEY, applied_at INTEGER)');
    for (const m of migrations.slice(0, -1)) {
      for (const statement of m.sql.split('--> statement-breakpoint')) sqlite.exec(statement);
      sqlite.run('INSERT INTO _migrations VALUES (?, ?)', m.tag, 0);
    }
    sqlite.exec(
      "INSERT INTO roadmap_steps (id, created_at, updated_at, rev, roadmap_id, title, position, status, done_at) VALUES ('s', 1, 2, 1, 'r', 'Existing milestone', 0, 'done', 2)",
    );
    migrate(sqlite);
    migrate(sqlite);
    expect(
      sqlite.all('SELECT title, status, done_at, description, notes FROM roadmap_steps'),
    ).toEqual([
      { title: 'Existing milestone', status: 'done', done_at: 2, description: '', notes: '' },
    ]);
  } finally {
    sqlite.close();
  }
});
