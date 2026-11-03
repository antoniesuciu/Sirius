/**
 * The only module that knows the SQLite driver (ADR-2: Bun-only APIs stay in runtime/).
 * Moving to Node means replacing this file and serve.ts.
 */
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from '../db/schema.ts';

export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export interface SqliteHandle {
  db: Db;
  exec(sql: string): void;
  all<T>(sql: string, ...params: Array<string | number | null>): T[];
  run(sql: string, ...params: Array<string | number | null>): void;
  /** Atomic snapshot to `path`. Must run outside a transaction. */
  vacuumInto(path: string): void;
  close(): void;
}

export function openSqlite(path: string): SqliteHandle {
  const raw = new Database(path, { create: true });
  // WAL + NORMAL: durable across a power cut, at the cost of at most the last commits
  // being lost, never corruption (spec section 4.2).
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA busy_timeout = 2000');
  return {
    db: drizzle(raw) as unknown as Db,
    exec: (sql) => raw.exec(sql),
    all: <T>(sql: string, ...params: Array<string | number | null>) =>
      raw.query(sql).all(...params) as T[],
    run: (sql, ...params) => {
      raw.query(sql).run(...params);
    },
    vacuumInto: (target) => raw.query('VACUUM INTO ?').run(target),
    close: () => raw.close(),
  };
}
