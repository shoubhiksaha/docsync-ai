import { NextResponse } from 'next/server';
import { assetLinks } from '@/core/android';
import { appEnvironment } from '@/core/env';

export const dynamic = 'force-dynamic';

/** Digital Asset Links for the Play Store app (core/android.ts). Public: Android fetches it unsigned. */
export function GET() {
  return NextResponse.json(assetLinks(appEnvironment() === 'production'), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
