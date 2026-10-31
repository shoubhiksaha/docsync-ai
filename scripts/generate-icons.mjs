// Renders the PWA / home-screen icons from public/icon.svg into public/icons/.
// Usage: node scripts/generate-icons.mjs   (re-run whenever icon.svg changes, then commit the PNGs)
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readFile } from 'fs/promises';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public', 'icon.svg');
const outDir = path.join(root, 'public', 'icons');

// Background of icon.svg's rounded square, used wherever the icon needs a solid fill.
const BACKGROUND = '#0a0a0a';

const svg = await readFile(source);
await mkdir(outDir, { recursive: true });

const render = (size) => sharp(svg, { density: 384 }).resize(size, size).png();

/** Artwork scaled into the centre of a solid square (safe zone for maskable icons). */
async function padded(size, scale) {
  const inner = Math.round(size * scale);
  const art = await render(inner).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: art, gravity: 'centre' }])
    .flatten({ background: BACKGROUND })
    .png();
}

await render(192).toFile(path.join(outDir, 'icon-192.png'));
await render(512).toFile(path.join(outDir, 'icon-512.png'));
// Maskable icons may be cropped to a circle: keep the artwork inside the central 80%.
await (await padded(512, 0.8)).toFile(path.join(outDir, 'maskable-512.png'));
// iOS ignores transparency (it renders it black), so flatten onto the icon background.
await render(180).flatten({ background: BACKGROUND }).toFile(path.join(outDir, 'apple-touch-icon.png'));

console.log(`Icons written to ${path.relative(root, outDir)}/`);
