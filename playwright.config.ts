import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-360',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'mobile-412',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
  webServer: {
    command: 'node --env-file=.env.e2e dist/node/src/server/index.js',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
