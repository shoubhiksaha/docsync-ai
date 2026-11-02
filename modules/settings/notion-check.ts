/**
 * One cheap request (the saved database) that tells whether a Notion connection still works, so
 * Settings doesn't say "Connected" after DocSync was removed from Notion's connections or the
 * database was deleted. As with key-check, only a clear answer counts; a timeout or outage leaves
 * the connection unchecked, since it may well be fine.
 */

export type NotionState = 'ok' | 'revoked' | 'missing_db' | 'unchecked';

export const NOTION_CHECK_TIMEOUT_MS = 5_000;

export async function checkNotion(token: string, databaseId: string): Promise<NotionState> {
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
      signal: AbortSignal.timeout(NOTION_CHECK_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      return data?.archived || data?.in_trash ? 'missing_db' : 'ok';
    }
    // 401/403: the token was revoked or lost its access. 404: the database was deleted, or is no longer shared with DocSync.
    if (res.status === 401 || res.status === 403) return 'revoked';
    if (res.status === 404) return 'missing_db';
    return 'unchecked';
  } catch {
    return 'unchecked';
  }
}
