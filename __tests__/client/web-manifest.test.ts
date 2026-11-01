import { webManifest } from '@/app/app.webmanifest/web-manifest';
import { translator } from '@/client/i18n';

describe('web app manifest', () => {
  it("offers this device's recent document types as shortcuts, in its language", () => {
    const manifest = webManifest('hi', translator('hi'), ['kirana-khata', 'dairy-collection-slip']);
    expect(manifest.lang).toBe('hi');
    expect(manifest.shortcuts?.map(s => s.url)).toEqual(['/scan/kirana-khata', '/scan/dairy-collection-slip']);
    for (const shortcut of manifest.shortcuts ?? []) expect(shortcut.name).toMatch(/स्कैन करें$/);
  });

  it('falls back to one shortcut to Home before anything was scanned', () => {
    const manifest = webManifest('en', translator('en'), []);
    expect(manifest.shortcuts).toEqual([expect.objectContaining({ name: 'Scan a document', url: '/' })]);
    expect(manifest.description).toMatch(/An offering by ADT/);
  });

  it('skips document types that no longer exist', () => {
    expect(webManifest('en', translator('en'), ['gone', 'kirana-khata']).shortcuts?.map(s => s.url)).toEqual(['/scan/kirana-khata']);
  });
});
