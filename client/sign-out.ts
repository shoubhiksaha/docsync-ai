/**
 * Sign-out order: sign out on the server first, and only once that worked delete what this device
 * holds (scans, offline pages, preferences). Offline, or when the request fails, nothing is deleted
 * and the user stays signed in, so they can try again later without losing unsaved work.
 */
import type { StoredScan } from './scan-store';

export interface SignOutSteps {
  isOnline: () => boolean;
  /** Ends the server session; throws when the request fails. */
  signOut: () => Promise<void>;
  /** Asks the server again, so a sign-out the server refused isn't mistaken for success. */
  isSignedIn: () => Promise<boolean>;
  clearDevice: () => Promise<void>;
  goToLogin: () => void;
}

export type SignOutResult = 'done' | 'offline' | 'failed';

/** Scans that only exist on this device: offline photos never read, and saves waiting for a retry. */
export function unsavedCount(scans: Pick<StoredScan, 'status'>[]): number {
  return scans.filter((scan) => scan.status !== 'saved').length;
}

export async function signOutThenClear(steps: SignOutSteps): Promise<SignOutResult> {
  if (!steps.isOnline()) return 'offline';
  try {
    await steps.signOut();
    if (await steps.isSignedIn()) return 'failed';
  } catch {
    return 'failed';
  }
  await steps.clearDevice();
  steps.goToLogin();
  return 'done';
}
