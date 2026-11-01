/** `bun run dev`: the core and the Vite dev server together. Ctrl-C stops both. */
import { resolve } from 'node:path';

const procs = [
  Bun.spawn(['bun', 'run', '--watch', 'packages/core/src/main.ts'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      SIRIUS_MCP_COMMAND: `${process.execPath} run ${resolve('packages/mcp/src/main.ts')}`,
    },
  }),
  Bun.spawn(['bunx', 'vite'], { cwd: 'apps/desktop', stdio: ['ignore', 'inherit', 'inherit'] }),
];

const stop = () => {
  for (const proc of procs) proc.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await Promise.all(procs.map((p) => p.exited));
