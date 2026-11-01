import { NextResponse, NextRequest } from 'next/server';
import { isModuleEnabled } from '@/core/env';
import { withTimeout } from '@/core/isolation';
import { createDatabaseForUser } from '@/modules/notion';
import { loadSettings, saveSettings } from '@/modules/settings';

/** Every outcome lands on Settings as ?notion=<code>, which shows a message for it. */
type Outcome = 'connected' | 'no_page' | 'cancelled' | 'failed' | 'disabled' | 'not_configured';

/** The one-time OAuth state is spent whatever the outcome. */
function backToSettings(req: NextRequest, outcome: Outcome) {
  const response = NextResponse.redirect(new URL(`/settings?notion=${outcome}`, req.url));
  response.cookies.delete('notion_oauth_state');
  return response;
}

/**
 * The whole callback (token exchange, database lookup or creation) fits in this budget, so a slow
 * Notion ends on the "couldn't connect" notice instead of a blank page that never loads.
 */
const CALLBACK_BUDGET_MS = 25_000;

/** Title of the database createDatabaseForUser makes. */
const DATABASE_TITLE = 'DocSync AI Data';

/**
 * A "DocSync AI Data" database this token can already reach: the one saved before, else one found
 * by title. Reconnecting then keeps writing to the same database instead of creating another.
 */
async function existingDatabase(accessToken: string, savedId: string | undefined): Promise<string | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  try {
    if (savedId) {
      const saved = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(savedId)}`, { headers, signal: AbortSignal.timeout(10_000) });
      const data = saved.ok ? await saved.json() : null;
      if (data?.id && !data.archived && !data.in_trash) return savedId;
    }
    const search = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: DATABASE_TITLE, filter: { value: 'database', property: 'object' }, page_size: 20 }),
      signal: AbortSignal.timeout(10_000),
    });
    const results: { id?: string; archived?: boolean; in_trash?: boolean; title?: { plain_text?: string }[] }[] = (await search.json())?.results ?? [];
    const match = results.find(r => r.id && !r.archived && !r.in_trash && r.title?.map(t => t.plain_text ?? '').join('') === DATABASE_TITLE);
    return match?.id ?? null;
  } catch (err) {
    console.error('[notion] looking for an existing database failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isModuleEnabled('notion')) return backToSettings(req, 'disabled');
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  // Notion sends error=access_denied when the user presses Cancel.
  if (error) return backToSettings(req, error === 'access_denied' ? 'cancelled' : 'failed');
  if (!code) return backToSettings(req, 'failed');

  const state = req.nextUrl.searchParams.get('state');
  const storedState = req.cookies.get('notion_oauth_state')?.value;
  if (!state || state !== storedState) return backToSettings(req, 'failed');

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return backToSettings(req, 'not_configured');

  try {
    let late = false;
    return await withTimeout(connect(req, code, clientId, clientSecret, () => late), CALLBACK_BUDGET_MS, 'Notion connect', () => { late = true; });
  } catch (err) {
    console.error('Notion OAuth exception:', err);
    return backToSettings(req, 'failed');
  }
}

/** `timedOut` turns true once the user has been sent back with "failed"; nothing is saved after that. */
async function connect(req: NextRequest, code: string, clientId: string, clientSecret: string, timedOut: () => boolean): Promise<NextResponse> {
  // Determine original host
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/auth/notion/callback`;

  // Exchange code for Notion access token
  const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Basic ${encodedCredentials}`
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Notion OAuth Error:', data);
    return backToSettings(req, 'failed');
  }

  const accessToken: string = data.access_token;
  // data.duplicated_template_id holds the database ID if they duplicated a template
  let databaseId: string | null = data.duplicated_template_id ?? null;
  databaseId ??= await existingDatabase(accessToken, (await loadSettings(req)).notionDbId);
  if (!databaseId) {
    try {
      databaseId = await createDatabaseForUser(accessToken);
    } catch (dbErr) {
      console.error('Failed to auto-create Notion database:', dbErr);
    }
  }

  // No page shared (or the database couldn't be made): keep any earlier connection as it was,
  // rather than saving a token that has nowhere to write.
  if (!databaseId) return backToSettings(req, 'no_page');
  if (timedOut()) return backToSettings(req, 'failed');

  const response = backToSettings(req, 'connected');
  // Lax: this response ends a redirect from notion.com. Also mirrored to Firestore while sync is on.
  await saveSettings(req, response, { notionKey: accessToken, notionDbId: databaseId }, { sameSite: 'lax' });
  return response;
}
