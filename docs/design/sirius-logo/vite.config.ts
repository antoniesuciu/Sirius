import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The playgrounds render the app's own components from packages/ui, so React must be one copy.
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [resolve(__dirname, '../../..')] } },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        mark: resolve(__dirname, 'mark.html'),
        logo: resolve(__dirname, 'logo.html'),
      },
    },
  },
});
