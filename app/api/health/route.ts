import { NextResponse } from 'next/server';
import { appEnvironment, appVersion } from '@/core/env';
import { aiHealth } from '@/modules/ai';
import { extractionHealth } from '@/modules/extraction';
import { mediaHealth } from '@/modules/media';
import { notionHealth } from '@/modules/notion';
import { settingsHealth } from '@/modules/settings';
import { sheetsHealth } from '@/modules/sheets';
import { transcriptionHealth } from '@/modules/transcription';

export const dynamic = 'force-dynamic';

type ModuleHealth = { enabled: boolean; configured: boolean; circuit: 'closed' | 'open' };

/**
 * Each probe is isolated: a module whose health check throws is reported as unhealthy, not a 500.
 * This endpoint is public, so the error itself goes to the server log, never into the response.
 */
async function probe<T extends ModuleHealth>(name: string, fn: () => T | Promise<T>): Promise<T | (ModuleHealth & { error: string })> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[health] ${name} check failed:`, err instanceof Error ? err.message : err);
    return { enabled: false, configured: false, circuit: 'open', error: 'health check failed' };
  }
}

export async function GET() {
  const [ai, extraction, transcription, sheets, notion, media, settings] = await Promise.all([
    probe('ai', aiHealth),
    probe('extraction', extractionHealth),
    probe('transcription', transcriptionHealth),
    probe('sheets', sheetsHealth),
    probe('notion', notionHealth),
    probe('media', mediaHealth),
    probe('settings', settingsHealth),
  ]);
  const modules = { ai, extraction, transcription, sheets, notion, media, settings };
  const degraded = Object.values(modules).some(m => m.enabled && m.circuit === 'open') || !modules.settings.configured;

  return NextResponse.json(
    {
      status: degraded ? 'degraded' : 'ok',
      environment: appEnvironment(),
      version: appVersion(),
      checkedAt: new Date().toISOString(),
      modules,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
