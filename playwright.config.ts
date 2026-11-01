import { defineConfig, devices } from '@playwright/test';

/** UI tests run against the production Vite build, per spec section 10. */
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
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'bunx vite preview --host 127.0.0.1',
    cwd: 'apps/desktop',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
