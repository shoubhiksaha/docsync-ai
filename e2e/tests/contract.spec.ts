import { test, expect } from '@playwright/test';

// Post-deploy contract checks, run against staging and production by the deploy workflows.
// TARGET_URL / EXPECTED_ENVIRONMENT / EXPECTED_VERSION pin each run to one environment and
// one build, so a production deploy carrying preview config (or a stale build) fails here.
// These checks are read-only: they never call the AI providers or write to Sheets/Notion.

const expectedEnvironment = process.env.EXPECTED_ENVIRONMENT;
const expectedVersion = process.env.EXPECTED_VERSION;
const MODULE_KEYS = ['ai', 'extraction', 'transcription', 'sheets', 'notion', 'media', 'settings'];

test.describe(`Live environment contract (${expectedEnvironment || 'any'})`, () => {
  test.beforeAll(() => {
    if (process.env.CI && !process.env.TARGET_URL) {
      throw new Error('TARGET_URL must be set when the contract suite runs in CI.');
    }
  });

  test('1. Health reports this environment and this build', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control'] || '').toContain('no-store');

    const body = await response.json();
    if (expectedEnvironment) {
      expect(body.environment).toBe(expectedEnvironment);
    } else {
      expect(['production', 'staging', 'development', 'test']).toContain(body.environment);
    }
    if (expectedVersion) {
      expect(body.version).toBe(expectedVersion);
    }
    expect(['ok', 'degraded']).toContain(body.status);
    for (const key of MODULE_KEYS) {
      expect(body.modules[key], `modules.${key}`).toBeDefined();
      expect(['closed', 'open']).toContain(body.modules[key].circuit);
    }
  });

  test('2. Auth gate protects pages and APIs', async ({ request }) => {
    const home = await request.get('/', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(home.status());
    expect(home.headers()['location'] || '').toContain('/login');

    const settings = await request.get('/api/settings', { maxRedirects: 0 });
    expect(settings.status()).toBe(401);
  });

  test('3. Login page loads, with the ADT badge, without uncaught exceptions', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/login', { waitUntil: 'load', timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /An offering by ADT/ })).toHaveAttribute('href', 'https://analogdigital.tech');

    expect(errors.filter((msg) => !msg.includes('net::ERR') && !msg.includes('Failed to fetch'))).toHaveLength(0);
  });

  test('4. There is no demo sign-in', async ({ page, request }) => {
    await page.goto('/login', { waitUntil: 'load', timeout: 30000 });
    await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);

    const guest = await request.post('/api/auth/guest', { maxRedirects: 0 });
    expect(guest.ok()).toBe(false);
    expect(guest.headers()['set-cookie'] || '').not.toContain('docsync_guest');
  });
});
