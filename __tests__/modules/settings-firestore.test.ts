// Firestore reachability, through the settings module's public API with firebase-admin mocked.
const getDoc = jest.fn();
const getFirestore = jest.fn(() => ({ collection: () => ({ doc: () => ({ get: getDoc }) }) }));
jest.mock('firebase-admin/app', () => ({ cert: (c: unknown) => c, getApps: () => [], initializeApp: () => ({}) }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: (...a: unknown[]) => getFirestore(...(a as [])) }));
jest.mock('next-auth/jwt', () => ({ getToken: async () => ({ email: 'u@example.com' }) }));

import { NextRequest } from 'next/server';
import type * as Settings from '@/modules/settings';

const RECHECK_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_500;
const req = () => new NextRequest('http://localhost/api/settings');

describe('settings: Firestore reachability', () => {
  const saved = { ...process.env };
  let settings: typeof Settings;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    process.env = { ...saved, ENCRYPTION_KEY: 'c'.repeat(64), GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@example.iam', GOOGLE_PRIVATE_KEY: 'key' };
    jest.resetModules(); // fresh per-instance state for each test
    settings = jest.requireActual('@/modules/settings');
    getDoc.mockReset().mockResolvedValue({ exists: false });
    getFirestore.mockClear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  afterAll(() => { process.env = saved; });

  it('is "not_configured" without credentials, and never probes', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    await expect(settings.settingsHealth()).resolves.toMatchObject({ persistence: 'not_configured', persistent: false, circuit: 'closed' });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('probes once, shares one in-flight probe, and caches the answer for a minute', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const [a, b] = await Promise.all([settings.settingsHealth(), settings.settingsHealth()]);
    expect([a.persistence, b.persistence]).toEqual(['ok', 'ok']);
    expect(getDoc).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(now + RECHECK_MS - 1000);
    await settings.settingsHealth();
    expect(getDoc).toHaveBeenCalledTimes(1);
    (Date.now as jest.Mock).mockReturnValue(now + RECHECK_MS + 1);
    await expect(settings.settingsHealth()).resolves.toMatchObject({ persistence: 'ok', persistent: true });
    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  it('a disabled API or missing database is unreachable: health opens the circuit and warns once, settings say "this device only"', async () => {
    getDoc.mockRejectedValue(new Error('7 PERMISSION_DENIED: Cloud Firestore API has not been used\nmore detail'));
    await expect(settings.settingsHealth()).resolves.toMatchObject({ persistence: 'unreachable', persistent: false, circuit: 'open' });
    await expect(settings.settingsStatus(req())).resolves.toMatchObject({ isPersistent: false, syncAvailable: false });
    await settings.loadSettings(req());
    expect(getDoc).toHaveBeenCalledTimes(1); // request paths skip Firestore while it's known to be down
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe('7 PERMISSION_DENIED: Cloud Firestore API has not been used');
  });

  it('a probe that hangs counts as unreachable after the timeout', async () => {
    jest.useFakeTimers();
    getDoc.mockReturnValue(new Promise(() => undefined));
    const health = settings.settingsHealth();
    await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
    await expect(health).resolves.toMatchObject({ persistence: 'unreachable' });
  });

  it('real reads update the state: one warning when it breaks, quiet while down, retried after a minute, back on success', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    getDoc.mockRejectedValue(new Error('denied'));
    await settings.loadSettings(req());
    await settings.loadSettings(req());
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(settings.settingsHealth()).resolves.toMatchObject({ persistence: 'unreachable' });

    (Date.now as jest.Mock).mockReturnValue(now + RECHECK_MS + 1);
    getDoc.mockResolvedValue({ exists: false });
    await settings.loadSettings(req());
    expect(getDoc).toHaveBeenCalledTimes(2);
    await expect(settings.settingsHealth()).resolves.toMatchObject({ persistence: 'ok' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the named database when FIRESTORE_DATABASE_ID is set', async () => {
    process.env.FIRESTORE_DATABASE_ID = 'staging';
    await settings.settingsHealth();
    expect(getFirestore).toHaveBeenCalledWith({}, 'staging');
  });
});
