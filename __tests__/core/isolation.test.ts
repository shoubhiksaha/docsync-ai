import {
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  CallerError,
  circuitState,
  isCallerError,
  ModuleSkip,
  recordFailure,
  resetBreakers,
  runIsolated,
  withTimeout,
} from '@/core/isolation';

describe('core/isolation', () => {
  beforeEach(() => {
    resetBreakers();
    delete process.env.MODULE_NOTION;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns ok with the value', async () => {
    const out = await runIsolated(async () => 42, { module: 'notion', timeoutMs: 1000 });
    expect(out).toMatchObject({ status: 'ok', value: 42 });
  });

  it('turns a thrown error into a failed outcome instead of throwing', async () => {
    const out = await runIsolated(async () => { throw new Error('boom'); }, { module: 'notion', timeoutMs: 1000 });
    expect(out).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('fails slow calls with a timeout', async () => {
    const out = await runIsolated(() => new Promise(r => setTimeout(r, 200)), { module: 'notion', timeoutMs: 20 });
    expect(out.status).toBe('failed');
    expect(out.status === 'failed' && out.error).toMatch(/timed out/);
  });

  it('skips a module that is switched off', async () => {
    process.env.MODULE_NOTION = 'off';
    const fn = jest.fn(async () => 1);
    const out = await runIsolated(fn, { module: 'notion', timeoutMs: 1000 });
    expect(out).toMatchObject({ status: 'skipped', code: 'disabled' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps ModuleSkip to skipped without counting a failure', async () => {
    const out = await runIsolated(async () => { throw new ModuleSkip('not connected'); }, { module: 'notion', timeoutMs: 1000 });
    expect(out).toEqual({ status: 'skipped', reason: 'not connected' });
    expect(circuitState('notion')).toBe('closed');
    const coded = await runIsolated(async () => { throw new ModuleSkip('no target', 'not_connected'); }, { module: 'notion', timeoutMs: 1000 });
    expect(coded).toEqual({ status: 'skipped', reason: 'no target', code: 'not_connected' });
  });

  it('opens the circuit after repeated failures and skips further calls', async () => {
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await runIsolated(async () => { throw new Error('down'); }, { module: 'notion', timeoutMs: 1000 });
    }
    expect(circuitState('notion')).toBe('open');
    const fn = jest.fn(async () => 1);
    const out = await runIsolated(fn, { module: 'notion', timeoutMs: 1000 });
    expect(out).toMatchObject({ status: 'skipped', code: 'paused' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('closes the circuit again after the cooldown', () => {
    const now = 1_000_000;
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure('k', now);
    expect(circuitState('k', now + 1)).toBe('open');
    expect(circuitState('k', now + BREAKER_COOLDOWN_MS + 1)).toBe('closed');
  });

  it('a success resets the failure count', async () => {
    await runIsolated(async () => { throw new Error('x'); }, { module: 'notion', timeoutMs: 1000 });
    await runIsolated(async () => { throw new Error('x'); }, { module: 'notion', timeoutMs: 1000 });
    await runIsolated(async () => 1, { module: 'notion', timeoutMs: 1000 });
    await runIsolated(async () => { throw new Error('x'); }, { module: 'notion', timeoutMs: 1000 });
    expect(circuitState('notion')).toBe('closed');
  });

  it('breaker keys are independent', async () => {
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await runIsolated(async () => { throw new Error('x'); }, { module: 'notion', breakerKey: 'a', timeoutMs: 1000 });
    }
    expect(circuitState('a')).toBe('open');
    expect((await runIsolated(async () => 'ok', { module: 'notion', breakerKey: 'b', timeoutMs: 1000 })).status).toBe('ok');
  });

  it('withTimeout resolves fast promises', async () => {
    await expect(withTimeout(Promise.resolve('v'), 100, 'x')).resolves.toBe('v');
  });

  it("a caller's own errors (expired session, deleted file, revoked token) never open the shared breaker", async () => {
    const own = [
      new CallerError('Your Google session has expired.'),
      Object.assign(new Error('not found'), { status: 404 }),
      Object.assign(new Error('forbidden'), { response: { status: 403 } }),
      Object.assign(new Error('unauthorized'), { code: '401' }),
    ];
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      for (const err of own) {
        expect(await runIsolated(async () => { throw err; }, { module: 'notion', timeoutMs: 1000 })).toMatchObject({ status: 'failed' });
      }
    }
    expect(circuitState('notion')).toBe('closed');
    expect(isCallerError(Object.assign(new Error('busy'), { status: 429 }))).toBe(false);
    expect(isCallerError(Object.assign(new Error('down'), { status: 503 }))).toBe(false);
    expect(isCallerError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(false);
  });

  it('a timeout aborts the signal it handed to the call, so a slow write is cancelled', async () => {
    let seen: AbortSignal | undefined;
    const out = await runIsolated(signal => {
      seen = signal;
      return new Promise(() => undefined);
    }, { module: 'notion', timeoutMs: 10 });
    expect(out.status).toBe('failed');
    expect(seen?.aborted).toBe(true);
  });
});
