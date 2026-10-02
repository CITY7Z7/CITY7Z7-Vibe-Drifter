import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './kanban-module/tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx tsx server.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
