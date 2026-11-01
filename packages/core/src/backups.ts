import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SqliteHandle } from './runtime/sqlite.ts';

const KEEP = 14;
const NAME = /^sirius-(\d{4}-\d{2}-\d{2})\.sqlite$/;

/** One `VACUUM INTO` snapshot per logical day, keeping the last 14 (section 10). */
export class Backups {
  constructor(
    private readonly sqlite: SqliteHandle,
    private readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private list(): string[] {
    return readdirSync(this.dir)
      .filter((f) => NAME.test(f))
      .sort();
  }

  /** A snapshot for this date, replacing any earlier one from the same day. */
  snapshot(date: string): string {
    const path = join(this.dir, `sirius-${date}.sqlite`);
    rmSync(path, { force: true });
    this.sqlite.vacuumInto(path);
    for (const old of this.list().slice(0, -KEEP)) rmSync(join(this.dir, old));
    return path;
  }

  runDaily(date: string): void {
    if (!this.list().includes(`sirius-${date}.sqlite`)) this.snapshot(date);
  }
}
