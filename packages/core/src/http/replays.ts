/**
 * A phone queues changes while the laptop is away and sends them when it is back (ADR 0010).
 * A send can fail after the core has already applied it, so each change carries a key, and a
 * key seen before gets the first answer again instead of a second change.
 */
import type { SqliteHandle } from '../runtime/sqlite.ts';

/** Longer than a phone is likely to stay offline with changes waiting. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export class Replays {
  constructor(
    private readonly sqlite: SqliteHandle,
    clock: () => number = Date.now,
  ) {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS replays (key TEXT PRIMARY KEY, status INTEGER, body TEXT, created_at INTEGER)',
    );
    sqlite.run('DELETE FROM replays WHERE created_at < ?', clock() - KEEP_MS);
    this.now = clock;
  }

  private readonly now: () => number;

  find(key: string): { status: number; body: string } | null {
    const [row] = this.sqlite.all<{ status: number; body: string }>(
      'SELECT status, body FROM replays WHERE key = ?',
      key,
    );
    return row ?? null;
  }

  remember(key: string, status: number, body: string): void {
    this.sqlite.run(
      'INSERT OR IGNORE INTO replays VALUES (?, ?, ?, ?)',
      key,
      status,
      body,
      this.now(),
    );
  }
}
