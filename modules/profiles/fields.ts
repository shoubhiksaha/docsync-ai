import { normalizeKey } from '@/core/text';
import type { RecordField } from './types';

/** First field whose key or label matches one of the aliases (normalized). */
export function findField(fields: RecordField[], aliases: string[]): RecordField | undefined {
  const wanted = new Set(aliases.map(normalizeKey));
  return fields.find(f => wanted.has(normalizeKey(f.key)) || wanted.has(normalizeKey(f.label)));
}

export function fieldValue(fields: RecordField[], aliases: string[]): string | undefined {
  const value = findField(fields, aliases)?.value?.trim();
  return value ? value : undefined;
}
