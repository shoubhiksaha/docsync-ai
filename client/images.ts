/**
 * Turns whatever the user adds (camera photos, uploads, PDFs, pasted images) into JPEG pages the
 * server accepts, and stitches pages into one image for archiving. Browser-only.
 */
export const MAX_PAGES = 4;
// Vision models scale photos down to about this size anyway, and on 2G every byte is seconds of
// upload: about half the bytes of 2000 px at 0.85, with handwriting still readable.
const MAX_EDGE = 1600;
const QUALITY = 0.7;

export class UnreadableFileError extends Error {
  constructor(public readonly reason: 'unsupported' | 'pdf') {
    super(reason);
  }
}

type Drawable = ImageBitmap | HTMLImageElement;

async function decode(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Some browsers reject the options bag or the format; try an <img> element.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new UnreadableFileError('unsupported');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new UnreadableFileError('unsupported'))), 'image/jpeg', quality);
  });
}

/** Downscales (never upscales) so the longest edge is at most `maxEdge`, and re-encodes as JPEG. */
export async function toJpeg(blob: Blob, maxEdge = MAX_EDGE, quality = QUALITY): Promise<Blob> {
  const image = await decode(blob);
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ('close' in image) image.close();
  return canvasToJpeg(canvas, quality);
}

async function pdfToPages(file: Blob, maxPages: number): Promise<Blob[]> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    const pages: Blob[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, MAX_EDGE / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      pages.push(await canvasToJpeg(canvas, QUALITY));
    }
    await task.destroy();
    return pages;
  } catch {
    throw new UnreadableFileError('pdf');
  }
}

const isPdf = (file: Blob) => file.type === 'application/pdf' || (file instanceof File && /\.pdf$/i.test(file.name));

/** Converts the chosen files to at most MAX_PAGES JPEG pages. */
export async function filesToPages(files: Blob[]): Promise<{ pages: Blob[]; truncated: boolean }> {
  const pages: Blob[] = [];
  let truncated = false;
  for (const file of files) {
    const room = MAX_PAGES - pages.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    if (isPdf(file)) {
      const pdfPages = await pdfToPages(file, room);
      pages.push(...pdfPages);
    } else if (!file.type || file.type.startsWith('image/')) {
      pages.push(await toJpeg(file));
    } else {
      throw new UnreadableFileError('unsupported');
    }
  }
  return { pages, truncated };
}

/** One image for archiving: pages stacked vertically at a common width. */
export async function stitchPages(pages: Blob[], width = 1200, quality = 0.75): Promise<Blob | null> {
  if (pages.length === 0) return null;
  if (pages.length === 1) return pages[0];
  const images = await Promise.all(pages.map(decode));
  const heights = images.map((img) => Math.round(img.height * (width / img.width)));
  const total = heights.reduce((a, b) => a + b, 0);
  const fit = Math.min(1, 6000 / total);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * fit);
  canvas.height = Math.round(total * fit);
  const ctx = canvas.getContext('2d');
  let y = 0;
  images.forEach((img, i) => {
    const h = Math.round(heights[i] * fit);
    ctx?.drawImage(img, 0, y, canvas.width, h);
    y += h;
    if ('close' in img) img.close();
  });
  return canvasToJpeg(canvas, quality);
}
