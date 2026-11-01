import { settings } from '../db/schema.ts';
import type { Store } from '../store.ts';

export class Settings {
  constructor(private readonly store: Store) {}

  all(): Record<string, unknown> {
    const rows = this.store.db.select().from(settings).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  get<T>(key: string, fallback: T): T {
    const value = this.store.write('system', (tx) => tx.peek('settings', key)?.value);
    return value === undefined || value === null ? fallback : (value as T);
  }

  set(key: string, value: unknown): void {
    this.store.write('user', (tx) => {
      if (tx.peek('settings', key)) tx.update('settings', key, { value });
      else tx.insert('settings', { key, value });
    });
  }
}
