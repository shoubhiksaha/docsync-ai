import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from '../support/session';
import { SAVED } from '../support/stubs';

// UX gate, run on a desktop and a phone viewport (see playwright.config.ts). It walks the main
// flow in mock mode and fails on serious/critical WCAG 2.2 AA violations, an off-screen primary
// action, clipped field values, horizontal scrolling, or dialogs that don't open on top / close.
// The save is answered by a stub, so the run never touches a Google account.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SAMPLE_RECEIPT = path.join(__dirname, '..', '..', 'public', 'sample-ngo-receipt.png');

async function expectAccessible(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${screen}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

test.describe('UX (local, mock mode)', () => {
  test('sign in → sample scan → check → save is accessible and usable at this screen size', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/login');
    await expectAccessible(page, 'login');
    await signIn(page.context(), baseURL!);
    await page.route('**/api/sync', (route) => route.fulfill({ json: SAVED }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/DocSync/);
    // Nothing interrupts the first visit.
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expectAccessible(page, 'home');

    await page.locator('a[href="/scan/ngo-receipt"]').click();
    await expect(page.getByRole('heading', { name: /Add a photo/ })).toBeVisible();
    // The page title is streamed after the content on a client-side navigation.
    await expect(page).toHaveTitle(/^Scan: .* · DocSync AI$/);
    await expectAccessible(page, 'capture');

    // Extraction starts by itself once a document is added.
    await page.getByRole('button', { name: /Try a sample/ }).click();
    await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Sample data, not read from your photo')).toBeVisible();
    await expectAccessible(page, 'review');

    // The primary action stays on screen, and no value or page content is cut off.
    const save = page.getByRole('button', { name: 'Save to Google Sheet' });
    const box = await save.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    // Real documents have long values; they must wrap rather than be cut off.
    await page.getByLabel('NGO Name', { exact: true }).fill('Shree Mahalakshmi Gramin Vikas Evam Shiksha Seva Trust, Kolhapur');
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('main input:not([type=file]), main textarea')]
        .filter((i) => i.offsetWidth && (i.scrollWidth > i.clientWidth + 1 || i.scrollHeight > i.clientHeight + 1)).length,
    );
    expect(clipped).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // Dialogs open on top of the page and close with Esc.
    await page.getByRole('button', { name: 'View photo' }).filter({ visible: true }).first().click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    await page.getByLabel('Amount', { exact: true }).fill('₹5,500');
    await save.click();
    await expect(page.getByRole('heading', { name: 'Saved', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Where it went' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan the next one' })).toBeVisible();
    await expectAccessible(page, 'done');

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Your own AI key (optional)' })).toBeVisible();
    await expectAccessible(page, 'settings');

    expect(errors).toEqual([]);
  });

  test('a photo shared from another app opens the scan with it added, and is gone once used', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await signIn(page.context(), baseURL!, 'e2e-share');
    await page.goto('/');
    // As in the installed Android app: the worker the app registers takes the share's POST.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      const form = Object.assign(document.createElement('form'), { method: 'post', enctype: 'multipart/form-data', action: '/share/incoming' });
      form.append(Object.assign(document.createElement('input'), { type: 'file', name: 'files', id: 'shared-files' }));
      document.body.append(form);
    });
    await page.setInputFiles('#shared-files', SAMPLE_RECEIPT);
    await page.locator('#shared-files').evaluate((input: HTMLInputElement) => input.form!.submit());

    await expect(page).toHaveURL(/\/share\?id=/);
    const shared = page.url();
    await expect(page.getByRole('heading', { level: 1, name: 'Which document is this?' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Shared photo 1' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await expectAccessible(page, 'share');

    // The same picker as Home; the card opens the scan with the photo, which is read straight away.
    await page.locator('a[href^="/scan/ngo-receipt?shared="]').first().click();
    await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible({ timeout: 60_000 });
    expect(new URL(page.url()).search).toBe('');

    // Used: the share page now says so, with a way Home (in a second tab: the review asks before leaving).
    const again = await page.context().newPage();
    await again.goto(shared);
    await expect(again.getByRole('heading', { level: 1, name: "We couldn't find the shared photo" })).toBeVisible();
    await expectAccessible(again, 'share gone');
    expect(errors).toEqual([]);
  });
});
