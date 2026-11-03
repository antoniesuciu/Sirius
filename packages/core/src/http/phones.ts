/**
 * Phones (ADR 0010). A phone pairs once with a short code shown on the laptop and gets its own
 * token, which the core stores only as a hash. Tokens live outside the domain tables, so they
 * never appear in the change log, a backup's history or an agent's view.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { SqliteHandle } from '../runtime/sqlite.ts';

const CODE_TTL_MS = 5 * 60 * 1000;
/** A 6-digit code with five guesses gives one chance in 200,000. */
const CODE_ATTEMPTS = 5;

interface Pairing {
  code: string;
  expiresAt: number;
  attemptsLeft: number;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class Phones {
  private pairing: Pairing | null = null;

  constructor(
    private readonly sqlite: SqliteHandle,
    private readonly clock: () => number = Date.now,
  ) {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS phones (token_hash TEXT PRIMARY KEY, name TEXT, created_at INTEGER)',
    );
  }

  /** One code at a time: asking again replaces the last one. */
  startPairing(): { code: string; expires_at: number } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.pairing = { code, expiresAt: this.clock() + CODE_TTL_MS, attemptsLeft: CODE_ATTEMPTS };
    return { code, expires_at: this.pairing.expiresAt };
  }

  /** Returns the new phone's token, or null for a wrong, used or expired code. */
  pair(code: string, name: string): string | null {
    const pairing = this.pairing;
    if (!pairing || this.clock() > pairing.expiresAt) return null;
    const wellFormed = /^\d{6}$/.test(code);
    if (!wellFormed || !timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code))) {
      pairing.attemptsLeft--;
      if (pairing.attemptsLeft <= 0) this.pairing = null;
      return null;
    }
    this.pairing = null;
    const token = randomBytes(32).toString('base64url');
    this.sqlite.run(
      'INSERT INTO phones VALUES (?, ?, ?)',
      hash(token),
      name.slice(0, 80),
      this.clock(),
    );
    return token;
  }

  verify(token: string): boolean {
    if (!token) return false;
    const rows = this.sqlite.all<{ n: number }>(
      'SELECT count(*) AS n FROM phones WHERE token_hash = ?',
      hash(token),
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  forgetAll(): { forgotten: number } {
    const [row] = this.sqlite.all<{ n: number }>('SELECT count(*) AS n FROM phones');
    this.sqlite.exec('DELETE FROM phones');
    return { forgotten: row?.n ?? 0 };
  }
}
