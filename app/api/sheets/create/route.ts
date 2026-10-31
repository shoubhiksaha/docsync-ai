import { NextRequest, NextResponse } from 'next/server';
import { isModuleEnabled } from '@/core/env';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { getProfile } from '@/modules/profiles';
import { createSheet } from '@/modules/sheets';

export type SheetColumn = { key: string; label: string };

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();
  if (!isModuleEnabled('sheets')) {
    return NextResponse.json({ error: 'Google Sheets sync is temporarily disabled.' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const profile = getProfile(body?.profileId);
    const columns: SheetColumn[] = Array.isArray(body?.columns)
      ? body.columns
          .filter((c: unknown): c is SheetColumn => Boolean(c) && typeof (c as SheetColumn).key === 'string')
          .map((c: SheetColumn) => ({ key: c.key.slice(0, 100), label: String(c.label || c.key).slice(0, 100) }))
      : [];

    if (!profile || columns.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const sheet = await createSheet({
      caller,
      tab: profile.sheetTab,
      title: typeof body.sheetTitle === 'string' && body.sheetTitle.trim() ? body.sheetTitle.trim().slice(0, 100) : profile.sheetTitle,
      columns,
    });

    const response = NextResponse.json({ success: true, ...sheet });
    // Per-profile sheet ID so later syncs go straight to it (read by the scan page).
    response.cookies.set(`docsync_sheet_${profile.id.replace(/-/g, '_')}`, sheet.spreadsheetId, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || errorText(error);
    console.error('[sheets/create] failed:', message);
    return NextResponse.json({ error: `Could not create the Google Sheet. Google says: ${message}` }, { status: 502 });
  }
}
