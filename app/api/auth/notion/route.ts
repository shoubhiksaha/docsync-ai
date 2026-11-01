import { NextResponse, type NextRequest } from 'next/server';
import { isModuleEnabled } from '@/core/env';
import { boundState, signedInAccount, signInFirst, STATE_COOKIE } from './state';

export async function GET(req: NextRequest) {
  // People arrive here from a button, so problems go back to Settings as a message, not as JSON.
  if (!isModuleEnabled('notion')) {
    return NextResponse.redirect(new URL('/settings?notion=disabled', req.url));
  }
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL('/settings?notion=not_configured', req.url));
  }
  // /api/auth/ is public (middleware.ts), so the session is checked here.
  const account = await signedInAccount(req);
  if (!account) return signInFirst(req);

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/notion/callback`);
  const state = crypto.randomUUID();

  // Notion OAuth Authorization URL
  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${redirectUri}&state=${state}`;

  // Redirect user to Notion's consent screen
  const response = NextResponse.redirect(notionAuthUrl);
  response.cookies.set(STATE_COOKIE, boundState(state, account), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 });
  return response;
}
