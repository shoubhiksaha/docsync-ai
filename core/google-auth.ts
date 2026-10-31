import { google, type drive_v3 } from 'googleapis';

export type GoogleAuth = InstanceType<typeof google.auth.OAuth2>;

/** Google API auth for the signed-in user's OAuth token. */
export function getGoogleAuth(accessToken: string): GoogleAuth {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

/** Escapes a value for a Drive `q` string literal. */
export function driveQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Finds a folder by name (optionally under a parent), creating it if missing. */
export async function ensureFolder(drive: drive_v3.Drive, folderName: string, parentId?: string): Promise<string> {
  const q = [
    `name=${driveQueryLiteral(folderName)}`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    ...(parentId ? [`${driveQueryLiteral(parentId)} in parents`] : []),
  ].join(' and ');
  const res = await drive.files.list({ q, spaces: 'drive', fields: 'files(id)', pageSize: 1 });
  const existing = res.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined },
    fields: 'id',
  });
  return created.data.id as string;
}
