/**
 * What DocSync asks Google for: who you are, and the Drive files it creates. The "DocSync AI Data"
 * spreadsheet is one of those files, so drive.file covers every Sheets call DocSync makes. The broad
 * spreadsheets scope is sensitive and would need Google's sensitive-scope review, so it is not asked for.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
] as const;

/** Error code /login shows when someone unticked Drive on Google's consent screen. */
export const MISSING_SCOPES_ERROR = 'Scopes';

/**
 * True when Google granted Drive. Google lets people untick it, and without it every save would
 * fail, so sign-in is refused instead. An absent scope string (not sent by
 * Google) is not treated as a refusal.
 */
export function hasRequiredScopes(granted: string | null | undefined): boolean {
  if (granted == null) return true;
  const scopes = new Set(granted.split(/\s+/));
  return GOOGLE_SCOPES.filter(s => s.startsWith('https://')).every(s => scopes.has(s));
}
