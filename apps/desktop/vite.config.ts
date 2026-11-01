import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The dev server adds the core's token itself, so it never reaches the browser bundle. */
function devToken(): string | undefined {
  const dataDir = process.env.SIRIUS_DATA_DIR ?? join(homedir(), '.local/share/sirius');
  try {
    return readFileSync(join(dataDir, 'token'), 'utf8').trim();
  } catch {
    return undefined;
  }
}

const coreUrl = `http://127.0.0.1:${process.env.SIRIUS_PORT ?? 7337}`;

export default defineConfig({
  plugins: [react()],
  // Tauri serves from a custom protocol, so assets must be relative.
  base: './',
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 300 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target: coreUrl,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (req) => {
            const token = devToken();
            if (token) req.setHeader('authorization', `Bearer ${token}`);
          });
        },
      },
    },
  },
  preview: { port: 4173, strictPort: true },
});
