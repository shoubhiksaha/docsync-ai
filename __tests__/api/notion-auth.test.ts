const getToken = jest.fn();
jest.mock('next-auth/jwt', () => ({ getToken: (...a: unknown[]) => getToken(...a) }));
jest.mock('@/modules/settings/firestore', () => ({
  firestoreForRequest: () => null,
  firestoreState: async () => 'not_configured',
  reportFirestore: () => undefined,
}));
const createDatabaseForUser = jest.fn();
jest.mock('@/modules/notion', () => ({ createDatabaseForUser: (...a: unknown[]) => createDatabaseForUser(...a) }));

import { NextRequest } from 'next/server';
import { GET as connect } from '@/app/api/auth/notion/route';
import { GET as callback } from '@/app/api/auth/notion/callback/route';
import { decrypt, encrypt } from '@/core/crypto';
import { accountId } from '@/core/device-owner';

function req(url: string, cookie = '') {
  return new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });
}

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const where = (res: Response) => res.headers.get('location');

describe('Notion connect routes', () => {
  const saved = { ...process.env };
  const fetchMock = jest.fn();
  let account = '';
  beforeEach(async () => {
    process.env = { ...saved, ENCRYPTION_KEY: 'e'.repeat(64), NOTION_CLIENT_ID: 'cid', NOTION_CLIENT_SECRET: 'secret', NEXTAUTH_URL: 'http://localhost' };
    getToken.mockReset().mockResolvedValue({ email: 'u@x' });
    account = (await accountId({ email: 'u@x' }))!;
    fetchMock.mockReset();
    createDatabaseForUser.mockReset().mockResolvedValue(null);
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = saved; });

  /** The session check (Web Crypto) finishes outside fake time: wait for the callback's first request to Notion. */
  const firstRequest = async () => {
    while (!fetchMock.mock.calls.length) await new Promise(resolve => setImmediate(resolve));
  };
  const authorised = (extra = '') => req('/api/auth/notion/callback?code=c&state=s', `notion_oauth_state=s.${account}${extra}`);

  it('sends problems back to Settings as a message instead of JSON', async () => {
    delete process.env.NOTION_CLIENT_ID;
    expect(where(await connect(req('/api/auth/notion')))).toBe('http://localhost/settings?notion=not_configured');
    process.env.MODULE_NOTION = 'off';
    expect(where(await connect(req('/api/auth/notion')))).toBe('http://localhost/settings?notion=disabled');
    expect(where(await callback(authorised()))).toBe('http://localhost/settings?notion=disabled');
  });

  it('every callback failure lands on Settings with a code', async () => {
    expect(where(await callback(req('/api/auth/notion/callback?error=access_denied')))).toBe('http://localhost/settings?notion=cancelled');
    expect(where(await callback(req('/api/auth/notion/callback?error=other')))).toBe('http://localhost/settings?notion=failed');
    expect(where(await callback(req('/api/auth/notion/callback')))).toBe('http://localhost/settings?notion=failed');
    expect(where(await callback(req('/api/auth/notion/callback?code=c&state=s', 'notion_oauth_state=x')))).toBe('http://localhost/settings?notion=failed');
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
    expect(where(await callback(authorised()))).toBe('http://localhost/settings?notion=failed');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(where(await callback(authorised()))).toBe('http://localhost/settings?notion=failed');
    delete process.env.NOTION_CLIENT_SECRET;
    expect(where(await callback(authorised()))).toBe('http://localhost/settings?notion=not_configured');
  });

  it('spends the one-time state on every outcome, and gives up on a Notion that does not answer', async () => {
    const cancelled = await callback(req('/api/auth/notion/callback?error=access_denied', 'notion_oauth_state=s'));
    expect(cancelled.cookies.get('notion_oauth_state')?.value).toBe('');

    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      fetchMock.mockReturnValueOnce(new Promise(() => undefined));
      const pending = callback(authorised());
      await firstRequest();
      await jest.advanceTimersByTimeAsync(25_000);
      const res = await pending;
      expect(where(res)).toBe('http://localhost/settings?notion=failed');
      expect(res.cookies.get('notion_oauth_state')?.value).toBe('');
      expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    } finally {
      jest.useRealTimers();
    }
  });

  it('saves nothing once too little time is left for the save to finish before the user is told it failed', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      fetchMock
        .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(json(200, { access_token: 'tok' })), 19_000)))
        .mockResolvedValueOnce(json(200, { results: [{ id: 'db-found', title: [{ plain_text: 'DocSync AI Data' }] }] }));
      const pending = callback(authorised());
      await firstRequest();
      await jest.advanceTimersByTimeAsync(19_000);
      const res = await pending;
      expect(where(res)).toBe('http://localhost/settings?notion=failed');
      expect(res.cookies.get('docsync_notion')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses the database inside a page duplicated from the integration's template, never the page itself", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok', duplicated_template_id: 'page-1' }))
      .mockResolvedValueOnce(json(200, { results: [{ id: 'para', type: 'paragraph' }, { id: 'db-in-page', type: 'child_database' }] }));
    const res = await callback(authorised());
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.notion.com/v1/blocks/page-1/children?page_size=100');
    expect(decrypt(res.cookies.get('docsync_notion_db')!.value)).toBe('db-in-page');

    // A template page without a database: found or created as usual.
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok', duplicated_template_id: 'page-2' }))
      .mockResolvedValueOnce(json(200, { results: [{ id: 'para', type: 'paragraph' }] }))
      .mockResolvedValueOnce(json(200, { results: [] }));
    createDatabaseForUser.mockResolvedValue('db-new');
    const created = await callback(authorised());
    expect(decrypt(created.cookies.get('docsync_notion_db')!.value)).toBe('db-new');
  });

  it('with no page shared, says so and keeps the earlier connection untouched', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(200, { results: [] }));
    const res = await callback(authorised());
    expect(where(res)).toBe('http://localhost/settings?notion=no_page');
    expect(res.cookies.get('docsync_notion')).toBeUndefined();
    expect(createDatabaseForUser).toHaveBeenCalledWith('tok', expect.any(AbortSignal));
  });

  it('needs a signed-in account at both ends, and saves only for the account that started', async () => {
    getToken.mockResolvedValue(null);
    expect(where(await connect(req('/api/auth/notion')))).toBe('http://localhost/login?callbackUrl=%2Fsettings');
    const signedOut = await callback(authorised());
    expect(where(signedOut)).toBe('http://localhost/login?callbackUrl=%2Fsettings');
    expect(signedOut.cookies.get('notion_oauth_state')?.value).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();

    getToken.mockResolvedValue({ email: 'u@x' });
    const started = await connect(req('/api/auth/notion'));
    const state = new URL(where(started)!).searchParams.get('state');
    expect(started.cookies.get('notion_oauth_state')?.value).toBe(`${state}.${account}`);

    // Another account signed in on this browser before Notion sent the user back.
    getToken.mockResolvedValue({ email: 'someone-else@x' });
    expect(where(await callback(authorised()))).toBe('http://localhost/settings?notion=failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never creates a second database when Notion could not say whether the first still exists', async () => {
    const savedDb = `; docsync_notion_db=${encrypt('db-old')}`;
    // The saved database's lookup times out, or is rate limited.
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect(where(await callback(authorised(savedDb)))).toBe('http://localhost/settings?notion=failed');
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(429, { message: 'rate limited' }));
    expect(where(await callback(authorised(savedDb)))).toBe('http://localhost/settings?notion=failed');
    // The title search fails.
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(404, { message: 'not found' }))
      .mockResolvedValueOnce(json(502, { message: 'bad gateway' }));
    expect(where(await callback(authorised(savedDb)))).toBe('http://localhost/settings?notion=failed');
    expect(createDatabaseForUser).not.toHaveBeenCalled();

    // Gone (404) and not found by title: only then is a new one made.
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(404, { message: 'not found' }))
      .mockResolvedValueOnce(json(200, { results: [] }));
    createDatabaseForUser.mockResolvedValue('db-new');
    const res = await callback(authorised(savedDb));
    expect(where(res)).toBe('http://localhost/settings?notion=connected');
    expect(decrypt(res.cookies.get('docsync_notion_db')!.value)).toBe('db-new');
    // Every Notion request can be ended by the callback's budget.
    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says "failed", not "no page", when Notion does not make the database', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(200, { results: [] }));
    createDatabaseForUser.mockRejectedValue(new Error('Notion database creation failed: 429'));
    const res = await callback(authorised());
    expect(where(res)).toBe('http://localhost/settings?notion=failed');
    expect(res.cookies.get('docsync_notion')).toBeUndefined();
  });

  it('reconnecting reuses the saved database when the new token can still reach it', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok2' }))
      .mockResolvedValueOnce(json(200, { id: 'db-old' }));
    const res = await callback(authorised(`; docsync_notion_db=${encrypt('db-old')}`));
    expect(where(res)).toBe('http://localhost/settings?notion=connected');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.notion.com/v1/databases/db-old');
    expect(createDatabaseForUser).not.toHaveBeenCalled();
    expect(decrypt(res.cookies.get('docsync_notion')!.value)).toBe('tok2');
    expect(decrypt(res.cookies.get('docsync_notion_db')!.value)).toBe('db-old');
    expect(res.cookies.get('docsync_notion')?.sameSite).toBe('lax');
  });

  it('otherwise finds an existing "DocSync AI Data" database by title before creating one', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(200, {
        results: [
          { id: 'other', title: [{ plain_text: 'DocSync AI Data (old)' }] },
          { id: 'trashed', in_trash: true, title: [{ plain_text: 'DocSync AI Data' }] },
          { id: 'db-found', title: [{ plain_text: 'DocSync ' }, { plain_text: 'AI Data' }] },
        ],
      }));
    const res = await callback(authorised());
    expect(decrypt(res.cookies.get('docsync_notion_db')!.value)).toBe('db-found');
    expect(createDatabaseForUser).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(200, { results: [] }));
    createDatabaseForUser.mockResolvedValue('db-new');
    const created = await callback(authorised());
    expect(where(created)).toBe('http://localhost/settings?notion=connected');
    expect(decrypt(created.cookies.get('docsync_notion_db')!.value)).toBe('db-new');
  });
});
