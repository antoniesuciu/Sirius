/** `bun run dev`: the core and the Vite dev server together. Ctrl-C stops both. */
export {};

const procs = [
  Bun.spawn(['bun', 'run', '--watch', 'packages/core/src/main.ts'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  }),
  Bun.spawn(['bunx', 'vite'], { cwd: 'apps/desktop', stdio: ['ignore', 'inherit', 'inherit'] }),
];

const stop = () => {
  for (const proc of procs) proc.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await Promise.all(procs.map((p) => p.exited));
