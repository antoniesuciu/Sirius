/**
 * Core API latency and memory against a real process on a throwaway database.
 * Spec targets: p95 < 10 ms for local CRUD, core < 80 MB. Run: `bun run bench/api.ts`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 7339;
const dataDir = mkdtempSync(join(tmpdir(), 'sirius-bench-'));
// Measures the compiled binary, which is what ships. `bun run` also holds the transpiler.
await Bun.$`bun build --compile --minify packages/core/src/main.ts --outfile dist/sirius-core`.quiet();
const core = Bun.spawn(['dist/sirius-core'], {
  env: {
    ...process.env,
    BUN_OPTIONS: '--smol',
    SIRIUS_DATA_DIR: dataDir,
    SIRIUS_PORT: String(port),
    SIRIUS_SEED: 'demo',
  },
  stdout: 'ignore',
});
const base = `http://127.0.0.1:${port}/v1`;

for (let i = 0; i < 100; i += 1) {
  if (
    await fetch(`${base}/health`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  await Bun.sleep(50);
}
const headers = {
  authorization: `Bearer ${readFileSync(join(dataDir, 'token'), 'utf8').trim()}`,
  'content-type': 'application/json',
};

const timed = async (fn: () => Promise<Response>): Promise<{ ms: number; res: Response }> => {
  const start = performance.now();
  const res = await fn();
  await res.clone().text();
  return { ms: performance.now() - start, res };
};

const rssMb = () => {
  const status = readFileSync(`/proc/${core.pid}/status`, 'utf8');
  return Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) / 1024;
};
const idleMb = rssMb();

const samples: number[] = [];
for (let i = 0; i < 500; i += 1) {
  const add = await timed(() =>
    fetch(`${base}/tasks`, { method: 'POST', headers, body: JSON.stringify({ title: `t${i}` }) }),
  );
  const { id } = (await add.res.json()) as { id: string };
  const done = await timed(() =>
    fetch(`${base}/tasks/${id}/complete`, { method: 'POST', headers }),
  );
  const read = await timed(() => fetch(`${base}/today`, { headers }));
  samples.push(add.ms, done.ms, read.ms);
}

samples.sort((a, b) => a - b);
const at = (q: number) => samples[Math.floor(samples.length * q)]?.toFixed(2);
console.log(`requests: ${samples.length}`);
console.log(`p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, p99 ${at(0.99)} ms (target p95 < 10 ms)`);
console.log(
  `core RSS ${idleMb.toFixed(1)} MB at start, ${rssMb().toFixed(1)} MB after load (target < 80 MB)`,
);

await Bun.sleep(8000);
console.log(`core RSS ${rssMb().toFixed(1)} MB after 8 s idle`);

core.kill();
await core.exited;
rmSync(dataDir, { recursive: true, force: true });
