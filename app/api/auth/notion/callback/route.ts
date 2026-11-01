import { NextResponse, NextRequest } from 'next/server';
import { isModuleEnabled } from '@/core/env';
import { withTimeout } from '@/core/isolation';
import { createDatabaseForUser } from '@/modules/notion';
import { FIRESTORE_CALL_TIMEOUT_MS, loadSettings, saveSettings } from '@/modules/settings';
import { boundState, signedInAccount, signInFirst, STATE_COOKIE } from '../state';

/** Every outcome lands on Settings as ?notion=<code>, which shows a message for it. */
type Outcome = 'connected' | 'no_page' | 'cancelled' | 'failed' | 'disabled' | 'not_configured';

/** The one-time OAuth state is spent whatever the outcome. */
function backToSettings(req: NextRequest, outcome: Outcome) {
  const response = NextResponse.redirect(new URL(`/settings?notion=${outcome}`, req.url));
  response.cookies.delete(STATE_COOKIE);
  return response;
}

/**
 * The whole callback (token exchange, database lookup or creation) fits in this budget, so a slow
 * Notion ends on the "couldn't connect" notice instead of a blank page that never loads.
 */
const CALLBACK_BUDGET_MS = 25_000;

/**
 * Time kept back for saving the connection (a Firestore read and write while sync is on). With less
 * left, the user is sent back with "failed" before anything is saved, so a save never lands after
 * that answer and later shows Notion as connected.
 */
const SAVE_RESERVE_MS = 2 * FIRESTORE_CALL_TIMEOUT_MS + 1_000;

/** Title of the database createDatabaseForUser makes. */
const DATABASE_TITLE = 'DocSync AI Data';

const notionHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' });

/** One request's own time limit, also ended by the callback's `signal`. */
const within = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);

/**
 * duplicated_template_id is the page Notion copied from the integration's template, not a
 * database: the database to write to is the first one inside that page, if any.
 */
async function templateDatabase(accessToken: string, pageId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children?page_size=100`, {
      headers: notionHeaders(accessToken),
      signal: within(signal, 10_000),
    });
    const blocks: { id?: string; type?: string }[] = (res.ok ? (await res.json())?.results : null) ?? [];
    return blocks.find(b => b.id && b.type === 'child_database')?.id ?? null;
  } catch (err) {
    console.error('[notion] reading the template page failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * A "DocSync AI Data" database this token can already reach: the one saved before, else one found
 * by title. Reconnecting then keeps writing to the same database instead of creating another.
 * null only when Notion answered that there is none; a lookup it didn't answer (timeout, rate
 * limit, outage) throws, since creating a database then would split records across two.
 */
async function existingDatabase(accessToken: string, savedId: string | undefined, signal: AbortSignal): Promise<string | null> {
  const headers = notionHeaders(accessToken);
  if (savedId) {
    const saved = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(savedId)}`, { headers, signal: within(signal, 10_000) });
    if (saved.ok) {
      const data = await saved.json();
      if (data?.id && !data.archived && !data.in_trash) return savedId;
    } else if (![400, 403, 404].includes(saved.status)) {
      // 404 (or 400/403): deleted, or not shared with this token. Anything else is no answer.
      throw new Error(`Notion database lookup failed (${saved.status})`);
    }
  }
  const search = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: DATABASE_TITLE, filter: { value: 'database', property: 'object' }, page_size: 20 }),
    signal: within(signal, 10_000),
  });
  if (!search.ok) throw new Error(`Notion database search failed (${search.status})`);
  const results: { id?: string; archived?: boolean; in_trash?: boolean; title?: { plain_text?: string }[] }[] = (await search.json())?.results ?? [];
  const match = results.find(r => r.id && !r.archived && !r.in_trash && r.title?.map(t => t.plain_text ?? '').join('') === DATABASE_TITLE);
  return match?.id ?? null;
}

export async function GET(req: NextRequest) {
  if (!isModuleEnabled('notion')) return backToSettings(req, 'disabled');
  // The session may have ended since Connect was tapped; nothing is saved without one.
  const account = await signedInAccount(req);
  if (!account) return signInFirst(req);
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  // Notion sends error=access_denied when the user presses Cancel.
  if (error) return backToSettings(req, error === 'access_denied' ? 'cancelled' : 'failed');
  if (!code) return backToSettings(req, 'failed');

  const state = req.nextUrl.searchParams.get('state');
  const storedState = req.cookies.get(STATE_COOKIE)?.value;
  // Also refused when another account signed in on this browser after the flow started.
  if (!state || boundState(state, account) !== storedState) return backToSettings(req, 'failed');

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return backToSettings(req, 'not_configured');

  try {
    const startedAt = Date.now();
    const timeLeft = () => CALLBACK_BUDGET_MS - (Date.now() - startedAt);
    // Every Notion request ends by the time only SAVE_RESERVE_MS is left, so no database is created
    // after the user has been told it failed (they would get another one on their next try).
    const signal = AbortSignal.timeout(CALLBACK_BUDGET_MS - SAVE_RESERVE_MS);
    return await withTimeout(connect(req, code, clientId, clientSecret, timeLeft, signal), CALLBACK_BUDGET_MS, 'Notion connect');
  } catch (err) {
    console.error('Notion OAuth exception:', err);
    return backToSettings(req, 'failed');
  }
}

/**
 * `timeLeft` is what remains of CALLBACK_BUDGET_MS; nothing is saved without SAVE_RESERVE_MS of it.
 * A Notion request that fails or is aborted by `signal` throws, and the user is sent back with "failed".
 */
async function connect(req: NextRequest, code: string, clientId: string, clientSecret: string, timeLeft: () => number, signal: AbortSignal): Promise<NextResponse> {
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
    signal: within(signal, 10_000),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Notion OAuth Error:', data);
    return backToSettings(req, 'failed');
  }

  const accessToken: string = data.access_token;
  let databaseId = typeof data.duplicated_template_id === 'string' ? await templateDatabase(accessToken, data.duplicated_template_id, signal) : null;
  databaseId ??= await existingDatabase(accessToken, (await loadSettings(req)).notionDbId, signal);
  // Only once Notion has said there is none; a failed search or create throws ("failed").
  databaseId ??= await createDatabaseForUser(accessToken, signal);

  // No page shared: keep any earlier connection as it was, rather than saving a token that has nowhere to write.
  if (!databaseId) return backToSettings(req, 'no_page');
  if (timeLeft() < SAVE_RESERVE_MS) return backToSettings(req, 'failed');

  const response = backToSettings(req, 'connected');
  // Lax: this response ends a redirect from notion.com. Also mirrored to Firestore while sync is on.
  await saveSettings(req, response, { notionKey: accessToken, notionDbId: databaseId }, { sameSite: 'lax' });
  return response;
}
