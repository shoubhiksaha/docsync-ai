/**
 * Notion module — writes one page per synced document.
 *
 * Reads the target database's schema first and only writes properties that exist with the right
 * type, so a database the user edited (or one created by an older version) never breaks a sync.
 * Supports both Notion API shapes: databases with data sources (2025-09-03) and the older
 * properties-on-database shape.
 */
import { Client } from '@notionhq/client';
import { uploadToNotion } from 'notion-multipart-uploader';
import { env, isModuleEnabled } from '@/core/env';
import { CallerError, circuitState } from '@/core/isolation';
import { notionPropertyUnion, type DocumentProfile, type RecordField } from '@/modules/profiles';
import { buildProperties, richText, type SchemaProperties } from './mapping';

export { buildProperties, parseDateToISO } from './mapping';

export interface NotionTarget {
  apiKey?: string | null;
  databaseId?: string | null;
}

/**
 * The user's own Notion connection. Each user's records go only to their own database: the
 * server's NOTION_API_KEY/NOTION_DATABASE_ID are used only on a single-tenant deployment
 * (SINGLE_TENANT=true), only when the user saved neither value, and never mixed with the user's.
 */
export function resolveNotionTarget(target: NotionTarget): { apiKey: string; databaseId: string } | null {
  if (target.apiKey || target.databaseId) {
    return target.apiKey && target.databaseId ? { apiKey: target.apiKey, databaseId: target.databaseId } : null;
  }
  const apiKey = env('SINGLE_TENANT') === 'true' ? env('NOTION_API_KEY') : undefined;
  const databaseId = apiKey ? env('NOTION_DATABASE_ID') : undefined;
  return apiKey && databaseId ? { apiKey, databaseId } : null;
}

type Parent = { type: 'data_source_id'; data_source_id: string } | { database_id: string };

async function resolveSchema(notion: Client, databaseId: string): Promise<{ parent: Parent; schema: SchemaProperties }> {
  const db = (await notion.databases.retrieve({ database_id: databaseId })) as unknown as {
    data_sources?: { id: string }[];
    properties?: SchemaProperties;
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (dataSourceId) {
    const ds = (await notion.dataSources.retrieve({ data_source_id: dataSourceId })) as unknown as { properties?: SchemaProperties };
    return { parent: { type: 'data_source_id', data_source_id: dataSourceId }, schema: ds.properties ?? {} };
  }
  return { parent: { database_id: databaseId }, schema: db.properties ?? {} };
}

export interface NotionSyncInput extends NotionTarget {
  profile: DocumentProfile;
  fields: RecordField[];
  note?: string;
  image?: Buffer | null;
  audio?: Buffer | null;
  audioMimeType?: string;
  /** 'm4a', 'ogg', …: Notion checks that the file name matches the content type. */
  audioExtension?: string;
  /** Aborts every request (the sync timeout fired), so a page that timed out is never created later. */
  signal?: AbortSignal;
}

const REQUEST_TIMEOUT_MS = 20_000;

/** A file that didn't attach to the page; the UI translates each code (client/i18n `done.warning.*`). */
export type NotionNote = 'notion_image_not_attached' | 'notion_voice_note_not_attached';

export interface NotionSyncResult {
  url: string | null;
  attachmentNotes: NotionNote[];
}

export async function syncRecord(input: NotionSyncInput): Promise<NotionSyncResult> {
  const target = resolveNotionTarget(input);
  if (!target) throw new CallerError('Notion is not connected.');

  const { signal } = input;
  const notion = new Client({
    auth: target.apiKey,
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...(signal ? { fetch: (url, init) => fetch(url, { ...init, signal } as RequestInit) } : {}),
  });
  const uploadOptions = { timeoutMs: REQUEST_TIMEOUT_MS, ...(signal ? { signal } : {}) };
  const { parent, schema } = await resolveSchema(notion, target.databaseId);
  const stamp = Date.now();
  const attachmentNotes: NotionNote[] = [];
  const attachFailed = (note: NotionNote) => (e: unknown) => {
    attachmentNotes.push(note);
    console.warn(`[notion] ${note}:`, e instanceof Error ? e.message : e);
    return null;
  };

  const [imageId, audioId] = await Promise.all([
    input.image
      ? uploadToNotion(target.apiKey, input.image, 'image/webp', `${input.profile.id}_${stamp}.webp`, uploadOptions).catch(attachFailed('notion_image_not_attached'))
      : null,
    input.audio
      ? uploadToNotion(target.apiKey, input.audio, input.audioMimeType || 'audio/webm', `voicenote_${stamp}.${input.audioExtension || 'webm'}`, uploadOptions).catch(attachFailed('notion_voice_note_not_attached'))
      : null,
  ]);
  // The sync already reported Notion as failed; creating the page now would make a second one on "Retry".
  signal?.throwIfAborted();

  const children: Record<string, unknown>[] = [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: richText('📄 Document Details'), color: 'blue_background' } },
  ];
  if (input.note || audioId) {
    children.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: richText(input.note || 'Voice note attached'),
        icon: { type: 'emoji', emoji: '📝' },
        color: 'gray_background',
        ...(audioId ? { children: [{ object: 'block', type: 'audio', audio: { type: 'file_upload', file_upload: { id: audioId } } }] } : {}),
      },
    });
  }
  // Two fields with the same label both appear ("Amount", "Amount (amount2)") instead of one overwriting the other.
  const data: Record<string, string> = {};
  for (const f of input.fields) {
    const name = f.label || f.key;
    data[name in data ? `${name} (${f.key})` : name] = f.value;
  }
  children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText('Raw Extracted Data') } });
  children.push({ object: 'block', type: 'code', code: { rich_text: richText(JSON.stringify(data, null, 2)), language: 'json' } });
  if (imageId) {
    children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText('Original Scan') } });
    children.push({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: imageId } } });
  }

  const properties = buildProperties(schema, {
    profile: input.profile,
    fields: input.fields,
    note: input.note,
    scannedAt: new Date(stamp).toISOString(),
  });

  const page = (await notion.pages.create({ parent, properties, children } as never)) as { url?: string };
  return { url: page.url ?? null, attachmentNotes };
}

/**
 * Notion OAuth: creates a "DocSync AI Data" database inside the first page the user shared,
 * with every property the profiles write. Returns the database id, or null.
 */
export async function createDatabaseForUser(accessToken: string): Promise<string | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  const search = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ filter: { value: 'page', property: 'object' }, page_size: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  const searchData = await search.json();
  const parentPageId = searchData?.results?.[0]?.id;
  if (!parentPageId) return null;

  const properties: Record<string, unknown> = {
    Name: { title: {} },
    Profile: { select: {} },
    Date: { date: {} },
    'Scanned At': { date: {} },
    Notes: { rich_text: {} },
    // No 'Original Image' link column: the photo is attached on the page itself, and a Drive link
    // isn't known yet when the page is made (Notion and Drive run side by side), so it stayed empty.
    Tags: { multi_select: {} },
  };
  for (const { name, type } of notionPropertyUnion()) {
    properties[name] = type === 'number' ? { number: { format: 'number' } } : { [type]: {} };
  }

  const created = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'DocSync AI Data' } }],
      properties,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const createdData = await created.json();
  if (!created.ok || !createdData?.id) {
    console.error('[notion] database creation failed:', createdData?.message ?? created.status);
    return null;
  }
  return createdData.id as string;
}

export function notionHealth() {
  return {
    enabled: isModuleEnabled('notion'),
    configured: Boolean(env('NOTION_CLIENT_ID') && env('NOTION_CLIENT_SECRET')) || Boolean(resolveNotionTarget({})),
    circuit: circuitState('notion'),
  };
}
