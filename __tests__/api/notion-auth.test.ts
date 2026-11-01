jest.mock('next-auth/jwt', () => ({ getToken: async () => ({ email: 'u@x' }) }));
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

function req(url: string, cookie = '') {
  return new NextRequest(`http://localhost${url}`, { headers: cookie ? { cookie } : {} });
}

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const where = (res: Response) => res.headers.get('location');

describe('Notion connect routes', () => {
  const saved = { ...process.env };
  const fetchMock = jest.fn();
  beforeEach(() => {
    process.env = { ...saved, ENCRYPTION_KEY: 'e'.repeat(64), NOTION_CLIENT_ID: 'cid', NOTION_CLIENT_SECRET: 'secret', NEXTAUTH_URL: 'http://localhost' };
    fetchMock.mockReset();
    createDatabaseForUser.mockReset().mockResolvedValue(null);
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = saved; });

  const authorised = (extra = '') => req('/api/auth/notion/callback?code=c&state=s', `notion_oauth_state=s${extra}`);

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

  it('with no page shared, says so and keeps the earlier connection untouched', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok' }))
      .mockResolvedValueOnce(json(200, { results: [] }));
    const res = await callback(authorised());
    expect(where(res)).toBe('http://localhost/settings?notion=no_page');
    expect(res.cookies.get('docsync_notion')).toBeUndefined();
    expect(createDatabaseForUser).toHaveBeenCalledWith('tok');
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
