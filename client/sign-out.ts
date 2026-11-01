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

export interface UnsavedScans {
  /** Not in the sheet: offline photos never read, and saves whose sheet row failed. */
  notInSheet: number;
  /** In the sheet, but the photo or Notion copy failed and is waiting for a retry. */
  sheetOnly: number;
}

/** Scans signing out would lose something of: their retries only exist on this device. */
export function unsavedScans(scans: Pick<StoredScan, 'status' | 'destinations'>[]): UnsavedScans {
  const unsaved = scans.filter((scan) => scan.status !== 'saved');
  const sheetOnly = unsaved.filter((scan) => scan.status === 'partial' && scan.destinations?.sheets?.status === 'success').length;
  return { notInSheet: unsaved.length - sheetOnly, sheetOnly };
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
