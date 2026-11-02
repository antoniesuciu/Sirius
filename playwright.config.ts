import { defineConfig, devices } from '@playwright/test';

export const LIVE_DATA_DIR = '.cache/e2e-core';
export const LIVE_PORT = 7338;
const REMOTE_PORT = 7347;
const REMOTE_DIR = '.cache/e2e-remote';

const previewEnv = { SIRIUS_PORT: String(LIVE_PORT), SIRIUS_DATA_DIR: `../../${LIVE_DATA_DIR}` };

/**
 * UI tests run against the production Vite build, per spec section 10. Most use the
 * fixture backend; live.spec.ts runs the same UI against a real core on a throwaway
 * database.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: { chromiumSandbox: false },
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /(live|remote)\.spec/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      testIgnore: /(live|remote)\.spec/,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      // A core started the way the container starts it, serving the UI itself.
      name: 'remote',
      testMatch: /remote\.spec/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://127.0.0.1:${REMOTE_PORT}`,
        extraHTTPHeaders: { authorization: 'Bearer e2e-token' },
      },
    },
    {
      name: 'live',
      testMatch: /live\.spec/,
      fullyParallel: false,
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: `rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && echo e2e-token > ${REMOTE_DIR}/token && bun run packages/core/src/main.ts`,
      url: `http://127.0.0.1:${REMOTE_PORT}/v1/health`,
      reuseExistingServer: false,
      env: {
        SIRIUS_MODE: 'remote',
        SIRIUS_DATA_DIR: REMOTE_DIR,
        SIRIUS_PORT: String(REMOTE_PORT),
        SIRIUS_UI_DIR: 'apps/desktop/dist',
        SIRIUS_SEED: 'demo',
      },
    },
    {
      command: `rm -rf ${LIVE_DATA_DIR} && bun run packages/core/src/main.ts`,
      url: `http://127.0.0.1:${LIVE_PORT}/v1/health`,
      reuseExistingServer: false,
      env: {
        SIRIUS_DATA_DIR: LIVE_DATA_DIR,
        SIRIUS_PORT: String(LIVE_PORT),
        SIRIUS_SEED: 'demo',
      },
    },
    {
      command: 'bunx vite preview --host 127.0.0.1',
      cwd: 'apps/desktop',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: previewEnv,
    },
  ],
});
