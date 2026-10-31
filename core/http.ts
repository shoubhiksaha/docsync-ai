import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export interface Caller {
  accessToken?: string;
  email?: string;
}

/**
 * The signed-in Google user, or null when there is no session.
 * Middleware already enforces this; routes check again so they're safe on their own.
 */
export async function resolveCaller(req: NextRequest): Promise<Caller | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  if (!token) return null;
  return {
    accessToken: typeof token.accessToken === 'string' && !token.error ? token.accessToken : undefined,
    email: typeof token.email === 'string' ? token.email : undefined,
  };
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseJson<T>(raw: FormDataEntryValue | null, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
