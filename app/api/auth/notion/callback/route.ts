import { NextResponse, NextRequest } from 'next/server';
import { encrypt } from '@/core/crypto';
import { isModuleEnabled } from '@/core/env';
import { createDatabaseForUser } from '@/modules/notion';

export async function GET(req: NextRequest) {
  if (!isModuleEnabled('notion')) {
    return NextResponse.redirect(new URL('/settings?notionError=disabled', req.url));
  }
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/?notionError=access_denied', req.url));
  }
  
  if (!code) {
    return NextResponse.redirect(new URL('/?notionError=no_code', req.url));
  }

  const state = req.nextUrl.searchParams.get('state');
  const storedState = req.cookies.get('notion_oauth_state')?.value;
  
  if (!state || state !== storedState) {
    return NextResponse.redirect(new URL('/?notionError=invalid_state', req.url));
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/?notionError=missing_env', req.url));
  }

  // Determine original host
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const redirectUri = `${baseUrl}/api/auth/notion/callback`;

  // Exchange code for Notion access token
  const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${encodedCredentials}`
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Notion OAuth Error:', data);
      return NextResponse.redirect(new URL('/?notionError=exchange_failed', req.url));
    }

    const accessToken = data.access_token;
    // data.duplicated_template_id might hold the database ID if they duplicated a template
    // data.workspace_id holds the workspace ID

    // Create the response object that redirects the user back to settings or home
    const response = NextResponse.redirect(new URL('/settings?notionConnected=true', req.url));

    // Store the encrypted token in the secure cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const, // Must be lax or strict for OAuth flows
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
    };

    response.cookies.set('docsync_notion', encrypt(accessToken), cookieOptions);

    let databaseId: string | null = data.duplicated_template_id ?? null;
    if (!databaseId) {
      try {
        databaseId = await createDatabaseForUser(accessToken);
      } catch (dbErr) {
        console.error('Failed to auto-create Notion database:', dbErr);
      }
    }

    if (databaseId) {
      response.cookies.set('docsync_notion_db', encrypt(databaseId), cookieOptions);
    }

    return response;

  } catch (err) {
    console.error('Notion OAuth exception:', err);
    return NextResponse.redirect(new URL('/?notionError=server_error', req.url));
  }
}
