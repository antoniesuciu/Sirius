import { defineConfig } from 'vitest/config';

// The suite runs under Bun (`bun run test`) so core tests exercise the production
// SQLite driver. `bun:*` builtins are unknown to Vite, so they must stay external.
export default defineConfig({
  plugins: [
    {
      name: 'sirius:bun-builtins',
      enforce: 'pre',
      resolveId(id) {
        return id.startsWith('bun:') ? { id, external: true } : undefined;
      },
    },
  ],
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'packages/**/test/**/*.test.tsx',
      'apps/**/src/**/*.test.ts',
      'bench/**/*.test.ts',
    ],
    server: { deps: { external: [/^bun:/] } },
  },
});
