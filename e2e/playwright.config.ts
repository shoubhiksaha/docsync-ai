import path from 'path';
import { loadEnvConfig } from '@next/env';
import { defineConfig, devices } from '@playwright/test';

// Three suites share this config:
//   smoke.spec.ts    — `npm run test:e2e`: starts the built app locally (mock mode) and drives it.
//   ux.spec.ts       — also `npm run test:e2e`, on desktop and phone viewports: accessibility (axe)
//                      and layout checks along the main scan flow.
//   contract.spec.ts — `npm run test:contract`: runs against a deployed environment (TARGET_URL),
//                      used by the post-deploy verification jobs in staging.yml / production.yml.
// When TARGET_URL or BASE_URL is set, no local server is started.
const remoteTarget = process.env.TARGET_URL || process.env.BASE_URL;
// The signed-in specs sign their session cookie with the same NEXTAUTH_SECRET as the server, so
// load the app's .env files the way `next start` does (CI sets the variables directly).
loadEnvConfig(path.join(__dirname, '..'));

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: remoteTarget || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Phone layout (Chromium engine, so CI needs no extra browser): only the UX gate runs here.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /ux\.spec\.ts/ },
  ],
  webServer: remoteTarget
    ? undefined
    : {
        command: 'npm run start',
        cwd: path.join(__dirname, '..'),
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});
