/**
 * Files attached to a chat message (F36). Agents have no file access by design (ADR-7), so the
 * core reads the file and the text goes into the prompt. Nothing is written to the database:
 * an attachment lives in memory for an hour, long enough to be sent, then it is gone.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DomainError } from './errors.ts';

const run = promisify(execFile);

export const MAX_BYTES = 20 * 1024 * 1024;
/** About 60 pages, or 40k tokens: a whole syllabus, without making every later turn costly. */
export const MAX_CHARS = 150_000;
const KEEP_MS = 60 * 60 * 1000;
const MAX_KEPT = 20;

export interface Kept {
  id: string;
  name: string;
  chars: number;
  truncated: boolean;
  /** Pages for a PDF, null otherwise. */
  pages: number | null;
}

interface Entry extends Kept {
  text: string;
  at: number;
}

const TEXT_TYPES = /\.(md|markdown|txt)$/i;
const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';

async function readPdf(bytes: Uint8Array): Promise<{ text: string; pages: number | null }> {
  const dir = await mkdtemp(join(tmpdir(), 'sirius-pdf-'));
  const file = join(dir, 'in.pdf');
  try {
    await writeFile(file, bytes);
    const [{ stdout: text }, info] = await Promise.all([
      run('pdftotext', ['-q', '-enc', 'UTF-8', file, '-'], { maxBuffer: 64 * 1024 * 1024 }),
      run('pdfinfo', [file]).catch(() => ({ stdout: '' })),
    ]);
    const pages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    return { text, pages: Number.isFinite(pages) ? pages : null };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new DomainError(
        503,
        'no_pdf_reader',
        'Reading PDFs needs poppler-utils on the laptop.',
      );
    }
    throw new DomainError(422, 'unreadable_pdf', 'That PDF could not be read.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Page breaks and runs of blank lines carry no meaning for an agent and cost tokens. */
function tidy(text: string): string {
  return text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class Attachments {
  private readonly kept = new Map<string, Entry>();

  constructor(private readonly clock: () => number = Date.now) {}

  async put(name: string, bytes: Uint8Array): Promise<Kept> {
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw new DomainError(413, 'file_too_large', 'Files can be up to 20 MB.');
    }
    let text: string;
    let pages: number | null = null;
    if (isPdf(bytes)) {
      ({ text, pages } = await readPdf(bytes));
    } else if (TEXT_TYPES.test(name)) {
      text = new TextDecoder().decode(bytes);
    } else {
      throw new DomainError(415, 'unsupported_file', 'Sirius reads PDF, Markdown and text files.');
    }
    text = tidy(text);
    if (!text) {
      throw new DomainError(
        422,
        'no_text',
        'There is no text in that file. A scanned PDF needs to be a text PDF first.',
      );
    }
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS);
    const entry: Entry = {
      id: randomUUID(),
      name: name.slice(0, 200),
      chars: text.length,
      truncated,
      pages,
      text,
      at: this.clock(),
    };
    this.prune();
    this.kept.set(entry.id, entry);
    const { text: _text, at: _at, ...kept } = entry;
    return kept;
  }

  take(id: string): { name: string; text: string; truncated: boolean } | undefined {
    this.prune();
    return this.kept.get(id);
  }

  private prune(): void {
    const now = this.clock();
    for (const [id, entry] of this.kept) {
      if (now - entry.at > KEEP_MS) this.kept.delete(id);
    }
    while (this.kept.size >= MAX_KEPT) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
  }
}
