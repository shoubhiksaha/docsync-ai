import {
  EARLY_TAP_TIMEOUT_MS, KEEP_EARLY_TAPS, LANGUAGE_ATTRIBUTE, SIGN_IN_ATTRIBUTE, SIGN_IN_STALLED_ID, createSignInGate, type SignInSteps,
} from '@/app/login/sign-in-gate';

function steps(overrides: Partial<SignInSteps> = {}) {
  const calls: string[] = [];
  const base: SignInSteps = {
    isOnline: () => true,
    // Never settles, like a sign-in stuck on a 2G link.
    signIn: () => { calls.push('signIn'); return new Promise(() => undefined); },
    onSlow: () => { calls.push('slow'); },
    onError: () => { calls.push('error'); },
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

  it('frees the controls at once and says so when sign-in fails', async () => {
    const gate = createSignInGate();
    // A weak signal still reports online; the request itself fails.
    const { calls, steps: s } = steps({ signIn: () => Promise.reject(new TypeError('Failed to fetch')) });
    gate.start('hero', s);
    await flush();
    expect(gate.owner()).toBeNull();
    expect(calls).toEqual(['error']);
    jest.advanceTimersByTime(60_000);
    expect(calls).toEqual(['error']);
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
    expect(first.calls).toEqual(['slow']);
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

describe('KEEP_EARLY_TAPS', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Just enough of a DOM element: a sign-in control, the language switch, or anything else. */
  class FakeElement {
    hidden = false;
    constructor(private attrs: Record<string, string> = {}) {}
    closest(selector: string) { return selector.slice(1, -1) in this.attrs ? this : null; }
    getAttribute(name: string) { return this.attrs[name] ?? null; }
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
  }

  /**
   * Runs the inline script against a page holding `controls` and the "reload" line; returns a way
   * to tap, and `back` for coming back to the page from the browser cache.
   */
  function page(controls: FakeElement[], stalled = new FakeElement()) {
    let listener: (event: object) => void = () => undefined;
    let pageshow: (event: object) => void = () => undefined;
    const document = {
      addEventListener: (_type: string, fn: typeof listener) => { listener = fn; },
      querySelector: (selector: string) => {
        const [, name, value] = /^\[([\w-]+)="(\w+)"\]$/.exec(selector) ?? [];
        return controls.find(c => c.getAttribute(name) === value) ?? null;
      },
      getElementById: (id: string) => (id === SIGN_IN_STALLED_ID ? stalled : null),
    };
    const window = { addEventListener: (_type: string, fn: typeof pageshow) => { pageshow = fn; } };
    new Function('document', 'Element', 'window', KEEP_EARLY_TAPS)(document, FakeElement, window);
    const tap = (target: FakeElement, init: Record<string, unknown> = {}) => {
      const event = { target, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
      listener(event);
      return event.defaultPrevented;
    };
    return Object.assign(tap, { back: () => pageshow({ persisted: true }) });
  }

  const control = (state = 'waiting') => new FakeElement({ [SIGN_IN_ATTRIBUTE]: state });

  it('keeps the first tap made before the page is ready, and only that one', () => {
    const hero = control();
    const header = control();
    const tap = page([hero, header]);
    expect(tap(hero)).toBe(true);
    expect(hero.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('queued');
    // A second tap elsewhere doesn't start a second sign-in, nor follow a link to /login.
    expect(tap(header)).toBe(true);
    expect(header.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('waiting');
  });

  it('leaves ready controls, other taps and new-tab clicks alone', () => {
    const ready = control('ready');
    const link = control();
    const tap = page([ready, link]);
    expect(tap(ready)).toBe(false);
    expect(tap(new FakeElement())).toBe(false);
    expect(tap(link, { ctrlKey: true })).toBe(false);
    expect(tap(link, { button: 1 })).toBe(false);
    expect(link.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('waiting');
  });

  it("stops spinning and says to reload when the page's JavaScript never arrives", () => {
    const hero = control();
    const stalled = new FakeElement();
    stalled.hidden = true;
    const tap = page([hero], stalled);
    tap(hero);
    jest.advanceTimersByTime(EARLY_TAP_TIMEOUT_MS - 1);
    expect(hero.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('queued');
    expect(stalled.hidden).toBe(true);
    jest.advanceTimersByTime(1);
    expect(hero.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('waiting');
    expect(stalled.hidden).toBe(false);
    // The control can be tapped again.
    expect(tap(hero)).toBe(true);
    expect(hero.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('queued');
  });

  it('leaves a kept tap alone once the control is ready', () => {
    const hero = control();
    const stalled = new FakeElement();
    stalled.hidden = true;
    const tap = page([hero], stalled);
    tap(hero);
    hero.setAttribute(SIGN_IN_ATTRIBUTE, 'ready');
    jest.advanceTimersByTime(EARLY_TAP_TIMEOUT_MS);
    expect(hero.getAttribute(SIGN_IN_ATTRIBUTE)).toBe('ready');
    expect(stalled.hidden).toBe(true);
  });

  it('lets the language switch post its form, with a spinner until the page is shown again', () => {
    const language = new FakeElement({ [LANGUAGE_ATTRIBUTE]: 'waiting' });
    const tap = page([language]);
    expect(tap(language)).toBe(false);
    expect(language.getAttribute(LANGUAGE_ATTRIBUTE)).toBe('sending');
    tap.back();
    expect(language.getAttribute(LANGUAGE_ATTRIBUTE)).toBe('waiting');

    const ready = new FakeElement({ [LANGUAGE_ATTRIBUTE]: 'ready' });
    expect(page([ready])(ready)).toBe(false);
    expect(ready.getAttribute(LANGUAGE_ATTRIBUTE)).toBe('ready');
  });
});
