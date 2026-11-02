import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { GOOGLE_SCOPES, MISSING_SCOPES_ERROR, hasRequiredScopes } from "@/app/login/google-scopes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshAccessToken(token: any) {
  try {
    const url = "https://oauth2.googleapis.com/token";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const refreshedTokens = await response.json();
    if (!response.ok) {
      throw refreshedTokens;
    }

    // A refresh that failed earlier (a network blip) must not keep saving switched off now that it worked.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { error, ...rest } = token;
    return {
      ...rest,
      accessToken: refreshedTokens.access_token,
      expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("Error refreshing access token", error);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: GOOGLE_SCOPES.join(" ")
        }
      }
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    // Errors NextAuth doesn't send to the sign-in page (AccessDenied, Configuration) land on /login too.
    error: '/login',
  },
  callbacks: {
    // Google lets people untick Sheets or Drive; without them every save fails, so send them back
    // to /login with a message instead of signing them in.
    async signIn({ account }) {
      if (account?.provider === "google" && !hasRequiredScopes(account.scope)) {
        return `/login?error=${MISSING_SCOPES_ERROR}`;
      }
      return true;
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.expiresAt = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000;
        token.refreshToken = account.refresh_token;
        return token;
      }
      if (Date.now() < (token.expiresAt as number) - 5 * 60 * 1000) {
        return token;
      }
      return await refreshAccessToken(token);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    }
  }
});

export { handler as GET, handler as POST };
