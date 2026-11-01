import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SpawnedLines {
  lines: AsyncIterable<string>;
  /** Resolves once the process has exited, with what it printed to stderr. */
  finished: Promise<{ code: number | null; stderr: string; spawnError?: string }>;
}

const STDERR_LIMIT = 4000;

/**
 * Runs a CLI and yields stdout line by line. Always argv, never a shell string (spec
 * section 8). stdin is /dev/null on purpose: with a pipe, `claude -p` waits 3 s for input.
 */
export function spawnLines(
  bin: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal; env?: Record<string, string> },
): SpawnedLines {
  const child = spawn(bin, args, {
    cwd: options.cwd,
    signal: options.signal,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    if (stderr.length < STDERR_LIMIT) stderr += String(chunk);
  });

  const finished = new Promise<{ code: number | null; stderr: string; spawnError?: string }>(
    (resolve) => {
      child.on('close', (code) => resolve({ code, stderr }));
      child.on('error', (error) => {
        // A failed spawn never closes stdout, so end the reader or the turn would hang.
        // An abort also lands here, and is reported by whoever owns the signal.
        lines.close();
        resolve({ code: null, stderr, spawnError: error.message });
      });
    },
  );

  return { lines, finished };
}

/** Runs a short command, returning whether it succeeded and what it printed. */
export async function probe(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const { lines, finished } = spawnLines(bin, args, {
      cwd,
      signal: AbortSignal.timeout(5000),
    });
    let output = '';
    for await (const line of lines) output += `${line}\n`;
    const { code, stderr, spawnError } = await finished;
    return { ok: code === 0, output: `${output}${stderr}${spawnError ?? ''}` };
  } catch (error) {
    return { ok: false, output: String(error) };
  }
}
