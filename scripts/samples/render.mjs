// Renders the fictional sample documents in scripts/samples/<id>.html into public/samples/<id>.jpg,
// the "Try a sample" document on each app's scan page. Each page draws one `.doc` element; the
// image is that element plus a little of the table around it.
// Usage: node scripts/samples/render.mjs [id ...]   (no ids = every sample; commit the JPGs)
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readdir } from 'fs/promises';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', '..', 'public', 'samples');
const requested = process.argv.slice(2);
const ids = requested.length
  ? requested
  : (await readdir(here)).filter(f => f.endsWith('.html')).map(f => f.slice(0, -'.html'.length));

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1.25 });
for (const id of ids) {
  await page.goto(`file://${path.join(here, `${id}.html`)}`);
  await page.evaluate(() => document.fonts.ready);
  const box = await page.locator('.doc').boundingBox();
  if (!box) throw new Error(`${id}.html has no .doc element`);
  const margin = 24;
  const clip = { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin };
  await page.screenshot({ path: path.join(outDir, `${id}.jpg`), type: 'jpeg', quality: 78, fullPage: true, clip });
  console.log(`public/samples/${id}.jpg`);
}
await browser.close();
