import { defineConfig, devices } from '@playwright/test';

const responsiveTestMatch = [
  /.*encoding-and-symbols\.spec\.mjs$/,
  /.*modal-accessibility\.spec\.mjs$/,
  /.*public-beta-surfaces\.spec\.mjs$/,
  // Student-critical phone flows get real device coverage in the scheduled
  // compatibility matrix, not only a desktop test that resizes itself.
  /.*mobile-nav\.spec\.mjs$/,
  /.*homework-course-icons\.spec\.mjs$/,
  /.*quick-capture-student-flow\.spec\.mjs$/,
  /.*today-redesign\.spec\.mjs$/,
  /.*onboarding-redesign\.spec\.mjs$/,
  /.*export-options-modal\.spec\.mjs$/
];

const playwrightPort = Number(process.env.PLAYWRIGHT_PORT || 5173);
const playwrightOutputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || '.tmp/playwright-results';
const playwrightTrace = process.env.PLAYWRIGHT_TRACE === 'off' ? 'off' : 'retain-on-failure';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: playwrightOutputDir,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // The former focus-restoration timing flake (export-modal Escape/focus) is
  // fixed deterministically: SutraModalManager now restores focus through a
  // single owner (onClose: immediate + rAF) instead of racing setTimeouts.
  // Proven stable at 10/10 with retries=0 locally, so no local retry is needed;
  // CI keeps a single retry only as generic shared-runner infra safety.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${playwrightPort}`,
    trace: playwrightTrace,
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `node scripts/serve-static.mjs ${playwrightPort}`,
    url: `http://127.0.0.1:${playwrightPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', testMatch: responsiveTestMatch, use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', testMatch: responsiveTestMatch, use: { ...devices['iPhone 13'] } },
    {
      name: 'tablet',
      testMatch: responsiveTestMatch,
      use: {
        ...devices['iPad Pro 11'],
        browserName: 'chromium'
      }
    },
    { name: 'narrow-desktop', testMatch: responsiveTestMatch, use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 720 } } }
  ]
});
