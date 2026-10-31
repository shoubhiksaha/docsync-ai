export type FieldCategory = 'identity' | 'financial' | 'date' | 'contact' | 'metadata' | 'other';

/** One extracted (or user-edited) field of a document. */
export interface RecordField {
  key: string;
  label: string;
  value: string;
  confidence?: number;
  category?: FieldCategory | string;
}

/** Home-page section a profile is listed under. */
export const PROFILE_GROUPS = ['shops', 'farm', 'transport', 'industry', 'crafts', 'community'] as const;
export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

export type NotionPropertyType = 'number' | 'rich_text' | 'date' | 'select';

export interface NotionPropertySpec {
  /** Property name in the Notion database. */
  name: string;
  type: NotionPropertyType;
  /** Candidate field keys/labels, matched case- and punctuation-insensitively. */
  from: string[];
}

/**
 * A document profile is one self-contained "utility app" (NGO receipts, weight slips, …).
 * Everything specific to a document type lives in its profile file; shared modules
 * (extraction, Sheets, Notion) read these definitions instead of hard-coding profile IDs.
 */
export interface DocumentProfile {
  id: string;
  /** Home-page card title, e.g. "NGO Donation Receipts". */
  title: string;
  /** Singular name shown while scanning, e.g. "NGO Donation Receipt". */
  documentName: string;
  description: string;
  /** Home-page section. */
  group: ProfileGroup;
  /** Google Sheets tab that receives this profile's rows. */
  sheetTab: string;
  /** Title for a newly created spreadsheet. */
  sheetTitle: string;
  sampleDocument?: { href: string; fileName: string };
  /** Field key used for duplicate checks until the user picks another one. */
  duplicateKey?: string;
  /** UI copy in other languages; English is the fields above. */
  translations?: { hi?: LocalizedProfileText };
  extraction: {
    /** Extra context for the extraction prompt. */
    context: string;
    /** Fields the model should always look for. */
    priorityFields: string[];
  };
  /** Returned when no AI provider is configured (local development / CI). */
  mockFields: RecordField[];
  notion: {
    titleFrom: string[];
    dateFrom: string[];
    properties: NotionPropertySpec[];
  };
  /** Adds computed fields (e.g. net weight). Must not throw; failures are contained anyway. */
  derive?(fields: RecordField[]): RecordField[];
  /** Business-rule checks; each string is a warning shown to the user. */
  validate?(fields: RecordField[]): string[];
}

export type Lang = 'en' | 'hi';

export interface LocalizedProfileText {
  title: string;
  documentName: string;
  description: string;
}

export interface ComingSoonProfile {
  title: string;
  description: string;
  hi?: { title: string; description: string };
}
