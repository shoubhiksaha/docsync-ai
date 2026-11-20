import { GET } from '@/app/.well-known/assetlinks.json/route';
import { ANDROID_APPS } from '@/core/android';

describe('/.well-known/assetlinks.json', () => {
  const original = process.env.APP_ENV;
  afterEach(() => { process.env.APP_ENV = original; });

  it('lets the Play Store app open production full screen', async () => {
    process.env.APP_ENV = 'production';
    const res = GET();
    expect(res.headers.get('content-type')).toContain('application/json');
    const [statement] = await res.json();
    expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statement.target).toEqual({
      namespace: 'android_app',
      package_name: 'tech.analogdigital.docsync',
      sha256_cert_fingerprints: ANDROID_APPS[0].fingerprints,
    });
  });

  it('never claims the app on staging', async () => {
    process.env.APP_ENV = 'staging';
    expect(await GET().json()).toEqual([]);
  });

  it('lists only well-formed SHA-256 fingerprints', () => {
    for (const app of ANDROID_APPS) {
      expect(app.fingerprints.length).toBeGreaterThan(0);
      for (const f of app.fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });
});
