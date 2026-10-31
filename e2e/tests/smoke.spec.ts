import fs from 'fs';
import path from 'path';
import { test, expect, type APIResponse } from '@playwright/test';
import { signIn } from '../support/session';
import { SAVED } from '../support/stubs';

// Smoke suite for the quality gate: the built app runs locally with no AI or Google
// credentials, so every module is in mock mode and nothing leaves the runner. Signed-in tests
// use a locally signed session (see ../support/session.ts); there is no demo mode.

const MODULE_KEYS = ['ai', 'extraction', 'transcription', 'sheets', 'notion', 'media', 'settings'];
const SAMPLE_RECEIPT = path.join(__dirname, '..', '..', 'public', 'sample-ngo-receipt.png');

async function expectRedirectToLogin(response: APIResponse) {
  expect([302, 303, 307, 308]).toContain(response.status());
  expect(response.headers()['location'] || '').toContain('/login');
}

test.describe('Smoke (local, mock mode)', () => {
  test('1. Health endpoint is public and reports every module', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control'] || '').toContain('no-store');

    const body = await response.json();
    expect(['ok', 'degraded']).toContain(body.status);
    expect(['production', 'staging', 'development', 'test']).toContain(body.environment);
    expect(typeof body.version).toBe('string');
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    for (const key of MODULE_KEYS) {
      expect(body.modules[key], `modules.${key}`).toBeDefined();
      expect(typeof body.modules[key].enabled).toBe('boolean');
      expect(typeof body.modules[key].configured).toBe('boolean');
      expect(['closed', 'open']).toContain(body.modules[key].circuit);
    }
  });

  test('2. Unauthenticated visitors are sent to login and API calls are rejected', async ({ request }) => {
    await expectRedirectToLogin(await request.get('/', { maxRedirects: 0 }));

    const settings = await request.get('/api/settings', { maxRedirects: 0 });
    expect(settings.status()).toBe(401);
    expect(await settings.json()).toHaveProperty('error');
  });

  test('3. Login offers Google sign-in only; demo sign-in is gone', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);

    const guest = await page.request.post('/api/auth/guest', { maxRedirects: 0 });
    expect(guest.ok()).toBe(false);
    expect(guest.headers()['set-cookie'] || '').not.toContain('docsync_guest');
  });

  test('4. Signed-in users land on the home page with active profiles', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await signIn(page.context(), baseURL!);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const ngo = page.locator('a[href="/scan/ngo-receipt"]');
    await expect(ngo).toBeVisible();
    await expect(ngo).toContainText('NGO Donation Receipts');

    const factory = page.locator('a[href="/scan/factory-weight-slip"]');
    await expect(factory).toBeVisible();
    await expect(factory).toContainText('Factory Scrap Weight-Slips');

    expect(errors).toHaveLength(0);
  });

  test('4b. The home page search filters the document apps', async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!);
    await page.goto('/');

    const ngo = page.locator('a[href="/scan/ngo-receipt"]');
    const factory = page.locator('a[href="/scan/factory-weight-slip"]');
    const search = page.getByRole('searchbox', { name: 'Find a document type' });

    await search.fill('weight');
    await expect(factory).toBeVisible();
    await expect(ngo).toHaveCount(0);
    // Other apps mention weight too, so only the wording is fixed, not the count.
    await expect(page.getByRole('search').getByRole('status')).toHaveText(/^Matching document types: \d+$/);

    await search.fill('');
    await expect(ngo).toBeVisible();
    await expect(factory).toBeVisible();
  });

  test('5. Extraction returns mock fields when no AI key is configured', async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!);

    const response = await page.request.post('/api/extract-freeform', {
      multipart: {
        document: {
          name: 'sample-ngo-receipt.png',
          mimeType: 'image/png',
          buffer: fs.readFileSync(SAMPLE_RECEIPT),
        },
        profileId: 'ngo-receipt',
      },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.isMock).toBe(true);
    expect(Array.isArray(body.fields)).toBe(true);
    expect(body.fields.length).toBeGreaterThan(0);
  });

  test('6. Every app reads a document and saves it, with the ADT badge on every screen', async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const adt = () => page.getByRole('link', { name: /An offering by ADT/ });

    await page.goto('/login');
    await expect(adt()).toHaveAttribute('href', 'https://analogdigital.tech');
    await signIn(page.context(), baseURL!);
    // The save is answered by a stub, so the run never touches a Google account.
    await page.route('**/api/sync', (route) => route.fulfill({ json: SAVED }));
    for (const screen of ['/', '/settings']) {
      await page.goto(screen);
      await expect(adt(), screen).toBeVisible();
    }

    // Every app listed on the home page, each read from its own sample document.
    await page.goto('/');
    const apps = (await page.locator('a[href^="/scan/"]').evaluateAll(links => links.map(a => a.getAttribute('href')!.slice('/scan/'.length).split('?')[0])))
      .filter((id, i, all) => all.indexOf(id) === i);
    expect(apps).toHaveLength(28);
    for (const app of apps) {
      // 28 back-to-back reads exceed one address's AI rate limit, so each app scans from its own.
      await page.setExtraHTTPHeaders({ 'x-real-ip': `e2e-${app}` });
      await page.goto(`/scan/${app}`);
      await expect(adt(), app).toBeVisible();
      await page.getByRole('button', { name: /Try a sample/ }).click();
      await expect(page.getByRole('heading', { name: 'Check the details' }), app).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: 'Save to Google Sheet' }).click();
      await expect(page.getByRole('heading', { name: 'Saved', exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(adt(), app).toBeVisible();
    }

    const badgeLoaded = await adt().locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(badgeLoaded).toBe(true);
    expect(errors).toEqual([]);
  });
});
