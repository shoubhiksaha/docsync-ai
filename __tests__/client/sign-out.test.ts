import { signOutThenClear, unsavedScans, type SignOutSteps } from '@/client/sign-out';

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

describe('unsavedScans', () => {
  const sheets = (status: 'success' | 'failed') => ({ sheets: { status, code: status === 'success' ? 'saved' : 'failed' } });

  it('counts offline photos and failed saves as not in the sheet, not saved scans', () => {
    expect(unsavedScans([{ status: 'saved' }, { status: 'offline' }, { status: 'failed' }])).toEqual({ notInSheet: 2, sheetOnly: 0 });
    expect(unsavedScans([{ status: 'saved' }])).toEqual({ notInSheet: 0, sheetOnly: 0 });
    expect(unsavedScans([])).toEqual({ notInSheet: 0, sheetOnly: 0 });
  });

  it('counts a partial save by whether its sheet row was written', () => {
    expect(unsavedScans([
      { status: 'partial', destinations: sheets('success') },
      { status: 'partial', destinations: sheets('failed') },
      // From before destinations were kept: the row may be missing.
      { status: 'partial' },
    ])).toEqual({ notInSheet: 2, sheetOnly: 1 });
  });
});
