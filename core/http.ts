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

/**
 * The request's form, or null when the body is over `maxBytes`. A Content-Length over the limit is
 * refused before anything is read; a body without one (chunked) is counted as it streams in and
 * dropped once it passes the limit, so an oversized upload is never held in memory whole.
 */
export async function readForm(req: Request, maxBytes: number): Promise<FormData | null> {
  if (Number(req.headers.get('content-length')) > maxBytes) return null;
  if (!req.body) return req.formData();
  let received = 0;
  let tooLarge = false;
  const limited = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received <= maxBytes) return controller.enqueue(chunk);
      tooLarge = true;
      controller.error(new Error('request body too large'));
    },
  }));
  try {
    return await new Response(limited, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (err) {
    if (tooLarge) return null;
    throw err;
  }
}

export function parseJson<T>(raw: FormDataEntryValue | null, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
