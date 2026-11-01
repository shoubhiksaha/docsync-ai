import { createSignInGate, type SignInSteps } from '@/app/login/sign-in-gate';

function steps(overrides: Partial<SignInSteps> = {}) {
  const calls: string[] = [];
  const base: SignInSteps = {
    isOnline: () => true,
    // Never settles, like a sign-in stuck on a 2G link.
    signIn: () => { calls.push('signIn'); return new Promise(() => undefined); },
    onSlow: () => { calls.push('slow'); },
  };
  return { calls, steps: { ...base, ...overrides } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('signInGate', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('does not start sign-in while offline', async () => {
    const gate = createSignInGate();
    const { calls, steps: s } = steps({ isOnline: () => false });
    expect(gate.start('hero', s)).toBe('offline');
    await flush();
    expect(calls).toEqual([]);
    expect(gate.owner()).toBeNull();
  });

  it('lets only the first control start sign-in, and every control sees it', async () => {
    const gate = createSignInGate();
    const seen = jest.fn();
    gate.subscribe(seen);
    const { calls, steps: s } = steps();
    expect(gate.start('hero', s)).toBe('started');
    expect(gate.start('header', s)).toBe('busy');
    expect(gate.start('doc-link', s)).toBe('busy');
    await flush();
    expect(calls).toEqual(['signIn']);
    expect(gate.owner()).toBe('hero');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('frees the controls and says so when Google does not open in time', async () => {
    const gate = createSignInGate(15_000);
    const { calls, steps: s } = steps();
    gate.start('hero', s);
    await flush();
    jest.advanceTimersByTime(14_999);
    expect(gate.owner()).toBe('hero');
    jest.advanceTimersByTime(1);
    expect(calls).toEqual(['signIn', 'slow']);
    expect(gate.owner()).toBeNull();
    expect(gate.start('header', s)).toBe('started');
  });

  it('frees the controls at once when sign-in fails', async () => {
    const gate = createSignInGate();
    const { calls, steps: s } = steps({ signIn: () => Promise.reject(new TypeError('Failed to fetch')) });
    gate.start('hero', s);
    await flush();
    expect(gate.owner()).toBeNull();
    jest.advanceTimersByTime(60_000);
    expect(calls).toEqual([]);
  });

  it('stays busy once NextAuth has sent the browser to Google', async () => {
    const gate = createSignInGate();
    const { calls, steps: s } = steps({ signIn: async () => undefined });
    gate.start('hero', s);
    await flush();
    jest.advanceTimersByTime(60_000);
    expect(calls).toEqual([]);
    expect(gate.start('header', s)).toBe('busy');
  });

  it('ignores a late failure from an attempt that already timed out', async () => {
    const gate = createSignInGate(1_000);
    let failFirst: (error: Error) => void = () => undefined;
    const first = steps({ signIn: () => new Promise((_, reject) => { failFirst = reject; }) });
    gate.start('hero', first.steps);
    await flush();
    jest.advanceTimersByTime(1_000);
    gate.start('header', steps().steps);
    failFirst(new Error('late'));
    await flush();
    expect(gate.owner()).toBe('header');
  });

  it('resets when the page comes back from the browser cache', async () => {
    const gate = createSignInGate();
    const { calls, steps: s } = steps();
    gate.start('hero', s);
    gate.reset();
    expect(gate.owner()).toBeNull();
    jest.advanceTimersByTime(60_000);
    expect(calls).not.toContain('slow');
  });
});
