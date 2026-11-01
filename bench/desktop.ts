/**
 * Section 4.1 budgets for the real desktop app on the real session. Opens a window for
 * about 30 seconds. Run from a desktop terminal: `bun run bench/desktop.ts`.
 *
 * Memory is PSS summed over the process tree, because WebKit's helper processes share a
 * lot of pages and summing RSS would count those several times.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 7337; // The port in the app's CSP, so the core must not already be running.
const SAMPLE_MS = 20_000;
const CLOCK_TICKS = 100;

const healthUrl = `http://127.0.0.1:${PORT}/v1/health`;
if (await fetch(healthUrl).then(() => true, () => false)) {
  console.error(`Something is already on port ${PORT}. Stop it first.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'sirius-desktop-'));
const env = { ...process.env, SIRIUS_DATA_DIR: dataDir, SIRIUS_PORT: String(PORT) };

await Bun.$`bun build --compile --minify packages/core/src/main.ts --outfile dist/sirius-core`.quiet();
const core = Bun.spawn(['dist/sirius-core'], {
  env: { ...env, BUN_OPTIONS: '--smol', SIRIUS_SEED: 'demo' },
  stdout: 'ignore',
});
for (let i = 0; i < 100; i += 1) {
  if (await fetch(healthUrl).then((r) => r.ok, () => false)) break;
  await Bun.sleep(30);
}

const start = performance.now();
const app = Bun.spawn(['apps/desktop/src-tauri/target/release/sirius-desktop'], {
  env: { ...env, SIRIUS_NO_AUTOSTART: '1' },
  stdout: 'ignore',
  stderr: 'pipe',
});

/** The app and every descendant: WebKit runs its renderer in helper processes. */
function processTree(root: number): number[] {
  const children = new Map<number, number[]>();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)]);
    } catch {
      // Processes come and go while we scan.
    }
  }
  const tree = [root];
  for (const pid of tree) tree.push(...(children.get(pid) ?? []));
  return tree;
}

function cpuTicks(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(fields[11]) + Number(fields[12]);
  } catch {
    return 0;
  }
}

function pssMb(pid: number): number {
  try {
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    return Number(rollup.match(/^Pss:\s+(\d+)/m)?.[1] ?? 0) / 1024;
  } catch {
    return 0;
  }
}

function connectedAt(): boolean {
  const tcp = readFileSync('/proc/net/tcp', 'utf8');
  const hex = PORT.toString(16).toUpperCase().padStart(4, '0');
  // Established (01) connections whose remote port is the core.
  return tcp.split('\n').some((line) => {
    const fields = line.trim().split(/\s+/);
    return fields[2]?.endsWith(`:${hex}`) && fields[3] === '01';
  });
}

let connectMs: number | null = null;
while (performance.now() - start < 8000) {
  if (connectedAt()) {
    connectMs = performance.now() - start;
    break;
  }
  await Bun.sleep(10);
}
console.log(
  connectMs === null
    ? 'FAILED: the webview never reached the core (CSP, CORS or a blank window?)'
    : `window to first core connection: ${connectMs.toFixed(0)} ms (target for paint < 400 ms)`,
);

await Bun.sleep(5000); // Let the entrance animations finish.

const before = processTree(app.pid).map((pid) => [pid, cpuTicks(pid)] as const);
await Bun.sleep(SAMPLE_MS);
const elapsedTicks = (SAMPLE_MS / 1000) * CLOCK_TICKS;
const usedTicks = before.reduce((sum, [pid, ticks]) => sum + (cpuTicks(pid) - ticks), 0);
console.log(`idle CPU, window visible: ${((usedTicks / elapsedTicks) * 100).toFixed(1)}% of one core (target < 1%)`);

const tree = processTree(app.pid);
const total = tree.reduce((sum, pid) => sum + pssMb(pid), 0);
console.log(`memory, process tree (PSS): ${total.toFixed(0)} MB across ${tree.length} processes (target < 200 MB)`);

app.kill();
core.kill();
await Promise.all([app.exited, core.exited]);
const stderr = await new Response(app.stderr).text();
if (stderr.trim()) console.log(`app stderr: ${stderr.slice(0, 600)}`);
rmSync(dataDir, { recursive: true, force: true });
