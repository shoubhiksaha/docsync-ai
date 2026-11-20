import { readFileSync } from 'fs';
import path from 'path';
import { webManifest } from '@/app/app.webmanifest/web-manifest';
import { ANDROID_APPS } from '@/core/android';
import { translator } from '@/client/i18n';

const twa = JSON.parse(readFileSync(path.join(__dirname, '../android/twa-manifest.json'), 'utf8'));

describe('Play Store app (android/twa-manifest.json)', () => {
  it('is the package the site vouches for in assetlinks.json', () => {
    expect(ANDROID_APPS.map(app => app.packageName)).toContain(twa.packageId);
    expect(twa.host).toBe('docsync.analogdigital.tech');
  });

  it('takes shares exactly as the web app does, so WhatsApp → DocSync works in both', () => {
    const { share_target: web } = webManifest('en', translator('en'), []) as { share_target: Record<string, unknown> };
    expect(twa.shareTarget).toEqual(web);
  });

  it('carries the version in package.json', () => {
    expect(twa.appVersionName).toBe(JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version);
  });
});
