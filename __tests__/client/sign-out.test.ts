import { signOutThenClear, unsavedCount, type SignOutSteps } from '@/client/sign-out';

function steps(overrides: Partial<SignOutSteps> = {}) {
  const calls: string[] = [];
  const base: SignOutSteps = {
    isOnline: () => true,
    signOut: async () => { calls.push('signOut'); },
    isSignedIn: async () => false,
    clearDevice: async () => { calls.push('clear'); },
    goToLogin: () => { calls.push('login'); },
  };
  return { calls, steps: { ...base, ...overrides } };
}

describe('signOutThenClear', () => {
  it('signs out on the server before deleting anything on the device', async () => {
    const { calls, steps: s } = steps();
    await expect(signOutThenClear(s)).resolves.toBe('done');
    expect(calls).toEqual(['signOut', 'clear', 'login']);
  });

  it('does nothing while offline', async () => {
    const { calls, steps: s } = steps({ isOnline: () => false });
    await expect(signOutThenClear(s)).resolves.toBe('offline');
    expect(calls).toEqual([]);
  });

  it('keeps local data when the sign-out request fails', async () => {
    const { calls, steps: s } = steps({ signOut: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(signOutThenClear(s)).resolves.toBe('failed');
    expect(calls).toEqual([]);
  });

  it('keeps local data when the server still has a session', async () => {
    const { calls, steps: s } = steps({ isSignedIn: async () => true });
    await expect(signOutThenClear(s)).resolves.toBe('failed');
    expect(calls).toEqual(['signOut']);
  });
});

describe('unsavedCount', () => {
  it('counts offline photos and failed or partial saves, not saved scans', () => {
    expect(unsavedCount([{ status: 'saved' }, { status: 'offline' }, { status: 'failed' }, { status: 'partial' }])).toBe(3);
    expect(unsavedCount([{ status: 'saved' }])).toBe(0);
    expect(unsavedCount([])).toBe(0);
  });
});
