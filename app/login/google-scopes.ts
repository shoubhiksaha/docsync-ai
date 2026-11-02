/** What DocSync asks Google for: who you are, the Drive files it creates, and your sheets. */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

/** Error code /login shows when someone unticked Sheets or Drive on Google's consent screen. */
export const MISSING_SCOPES_ERROR = 'Scopes';

/**
 * True when Google granted Drive and Sheets. Google lets people untick either one, and without
 * them every save would fail, so sign-in is refused instead. An absent scope string (not sent by
 * Google) is not treated as a refusal.
 */
export function hasRequiredScopes(granted: string | null | undefined): boolean {
  if (granted == null) return true;
  const scopes = new Set(granted.split(/\s+/));
  return GOOGLE_SCOPES.filter(s => s.startsWith('https://')).every(s => scopes.has(s));
}
