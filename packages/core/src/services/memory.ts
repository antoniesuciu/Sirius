/**
 * What Sirius keeps about the person across every session and agent (ADR 0008).
 *
 * It is a Markdown file rather than a table so the person can read and edit it by hand, for
 * example in Obsidian. The core is the only thing that touches it: agents get one `remember`
 * tool and the text in their prompt, never a path, so they still have no file access.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const HEADER =
  '# Sirius memory\n\nSirius reads this at the start of each session. Edit it freely.\n\n';
/** The newest lines win when the file outgrows this, since it goes into a prompt. */
const MAX_PROMPT_CHARS = 4_000;

export class Memory {
  constructor(private readonly path: string | null) {}

  read(): string | null {
    if (!this.path || !existsSync(this.path)) return null;
    const text = readFileSync(this.path, 'utf8');
    const body = text.startsWith(HEADER) ? text.slice(HEADER.length) : text;
    return body.trim().slice(-MAX_PROMPT_CHARS) || null;
  }

  remember(fact: string, date: string): { saved: boolean } {
    if (!this.path) return { saved: false };
    const line = fact.replace(/\s+/g, ' ').trim();
    if (!existsSync(this.path)) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, HEADER);
    } else if (readFileSync(this.path, 'utf8').includes(`: ${line}\n`)) {
      return { saved: true };
    }
    appendFileSync(this.path, `- ${date}: ${line}\n`);
    return { saved: true };
  }
}
