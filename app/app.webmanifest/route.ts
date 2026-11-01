import { cookies } from 'next/headers';
import { serverI18n } from '@/client/i18n/server';
import { RECENT_APPS_COOKIE, parseRecentApps } from '@/client/scan-store';
import { activeProfiles } from '@/modules/profiles';
import { webManifest } from './web-manifest';

/**
 * Served here rather than as app/manifest.ts: the layout links it with crossOrigin="use-credentials",
 * so the request carries this device's recent-apps and language cookies.
 */
export async function GET() {
  const { lang, t } = await serverI18n();
  const recent = parseRecentApps((await cookies()).get(RECENT_APPS_COOKIE)?.value, activeProfiles().map(p => p.id));
  return Response.json(webManifest(lang, t, recent), {
    // Different on every device, so no shared cache may keep it.
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, no-cache' },
  });
}
