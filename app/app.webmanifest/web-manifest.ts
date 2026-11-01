import type { MetadataRoute } from 'next';
import type { Lang, Translate } from '@/client/i18n';
import { getProfile, localizedProfile } from '@/modules/profiles';

const SHORTCUT_ICONS = [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }];

/**
 * The installed app's manifest. Its shortcuts (long-press on the home-screen icon) are the document
 * types this device scanned lately (`recentIds`, most recent first), in the interface language;
 * before there are any, one "Scan a document" opens Home.
 */
export function webManifest(lang: Lang, t: Translate, recentIds: readonly string[]): MetadataRoute.Manifest {
  const recent = recentIds.flatMap(id => getProfile(id) ?? []);
  const shortcuts = recent.length
    ? recent.map(profile => {
      const name = localizedProfile(profile, lang).documentName;
      return { name: t('manifest.scan', { name }), short_name: name, url: `/scan/${profile.id}`, icons: SHORTCUT_ICONS };
    })
    : [{ name: t('manifest.scanAny'), short_name: t('manifest.scanAny'), url: '/', icons: SHORTCUT_ICONS }];
  return {
    id: '/',
    name: 'DocSync AI',
    short_name: 'DocSync',
    lang,
    dir: 'ltr',
    description: t('manifest.description'),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f6f5',
    theme_color: '#ffffff',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts,
  };
}
