import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { env } from '@/core/env';
import { withTimeout } from '@/core/isolation';

/**
 * Lazily initialised Firestore. Nothing runs at import time, so a broken Firebase config only
 * disables persistent settings — it can't take down routes that merely import this module.
 * FIRESTORE_DATABASE_ID selects the database ("staging" on staging, "(default)" in production).
 */

let cached: Firestore | null | undefined;

export function firestoreConfigured(): boolean {
  return Boolean((env('FIREBASE_CLIENT_EMAIL') || env('GOOGLE_SERVICE_ACCOUNT_EMAIL')) && (env('FIREBASE_PRIVATE_KEY') || env('GOOGLE_PRIVATE_KEY')));
}

export function getDb(): Firestore | null {
  if (cached !== undefined) return cached;
  if (!firestoreConfigured()) {
    cached = null;
    return cached;
  }
  try {
    const app = getApps()[0] ?? initializeApp({
      credential: cert({
        projectId: env('FIREBASE_PROJECT_ID') || 'docsyncai1',
        clientEmail: env('FIREBASE_CLIENT_EMAIL') || env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        privateKey: (env('FIREBASE_PRIVATE_KEY') || env('GOOGLE_PRIVATE_KEY'))?.replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
      }),
    });
    const databaseId = env('FIRESTORE_DATABASE_ID');
    cached = databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);
  } catch (error) {
    console.error('[settings] Firestore initialisation failed:', error instanceof Error ? error.message : error);
    cached = null;
  }
  return cached;
}

// ─── Reachability ─────────────────────────────────────────────────────────────
// Credentials being set doesn't mean Firestore works: the API can be disabled or the database
// missing. The last outcome (a probe, or a real read/write) is kept for a minute per instance, so
// a broken Firestore is logged once a minute rather than on every request, and is skipped meanwhile.

export type FirestoreState = 'ok' | 'unreachable' | 'not_configured';

export const FIRESTORE_RECHECK_MS = 60_000;
export const FIRESTORE_PROBE_TIMEOUT_MS = 2_500;

let last: { state: 'ok' | 'unreachable'; at: number } | undefined;
let probing: Promise<'ok' | 'unreachable'> | undefined;

function shortError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200);
}

/** Records the outcome of a Firestore call; a newly failing Firestore is logged once. */
export function reportFirestore(ok: boolean, err?: unknown, now = Date.now()): void {
  if (!ok && last?.state !== 'unreachable') {
    console.warn('[settings] Firestore is unreachable; settings stay on each device until it is back:', shortError(err));
  }
  last = { state: ok ? 'ok' : 'unreachable', at: now };
}

/** Firestore for request paths: null when unconfigured or when it failed within the last minute. */
export function firestoreForRequest(now = Date.now()): Firestore | null {
  if (last?.state === 'unreachable' && now - last.at < FIRESTORE_RECHECK_MS) return null;
  return getDb();
}

/** Whether Firestore answers, checked with one small read at most once a minute. */
export async function firestoreState(now = Date.now()): Promise<FirestoreState> {
  const db = getDb();
  if (!db) return 'not_configured';
  if (last && now - last.at < FIRESTORE_RECHECK_MS) return last.state;
  probing ??= withTimeout(db.collection('_health').doc('probe').get(), FIRESTORE_PROBE_TIMEOUT_MS, 'Firestore')
    .then(() => { reportFirestore(true); return 'ok' as const; })
    .catch((err: unknown) => { reportFirestore(false, err); return 'unreachable' as const; })
    .finally(() => { probing = undefined; });
  return probing;
}
