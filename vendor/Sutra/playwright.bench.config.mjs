import { defineConfig, devices } from '@playwright/test';

// Standalone config for the heavy-workspace benchmark. Kept separate from the
// default suite (testDir ./tests/e2e) so `npm run test:e2e` never runs it; use
// `npm run bench:heavy`. Reuses the same static server.
export default defineConfig({
  testDir: './tests/bench',
  outputDir: '.tmp/playwright-bench',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off'
  },
  webServer: {
    command: 'node scripts/serve-static.mjs 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
