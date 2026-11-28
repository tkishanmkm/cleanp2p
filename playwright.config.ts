import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: process.env.TEST_APP_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          // Keep browser tests isolated from any configured project. These values
          // only let the login page render; no live Supabase endpoint is contacted.
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-playwright-test-anon-key-00000000000000000000000000000000',
        },
      },
});
