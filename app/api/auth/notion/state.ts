import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { accountId } from '@/core/device-owner';

/**
 * The one-time OAuth state, bound to the signed-in account that started the flow. The callback
 * saves a connection only for that same account: never into a signed-out browser's cookies, where
 * the next person to sign in on a shared phone would find it.
 */
export const STATE_COOKIE = 'notion_oauth_state';

/** The signed-in account (an opaque hash, see core/device-owner), or null without a session. */
export async function signedInAccount(req: NextRequest): Promise<string | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  return accountId(token);
}

export const boundState = (state: string, account: string) => `${state}.${account}`;

/** Signed out: sign in, then back to Settings to connect again. Any state is spent. */
export function signInFirst(req: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent('/settings')}`, req.url));
  response.cookies.delete(STATE_COOKIE);
  return response;
}
