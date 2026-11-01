import { normalizeKey } from '@/core/text';
import type { RecordField } from './types';

/**
 * The field whose key or label matches an alias (normalized), trying the aliases in order: the
 * first alias is the most specific, so a "Total" later on the slip wins over an earlier "Estimate".
 */
export function findField(fields: RecordField[], aliases: string[]): RecordField | undefined {
  const names = fields.map(f => [normalizeKey(f.key), normalizeKey(f.label)]);
  for (const alias of aliases.map(normalizeKey)) {
    const i = names.findIndex(([key, label]) => key === alias || label === alias);
    if (i >= 0) return fields[i];
  }
  return undefined;
}

/** Key of the field findField() picks, for tying a warning to it. */
export function fieldKey(fields: RecordField[], aliases: string[]): string | undefined {
  return findField(fields, aliases)?.key;
}

export function fieldValue(fields: RecordField[], aliases: string[]): string | undefined {
  const value = findField(fields, aliases)?.value?.trim();
  return value ? value : undefined;
}
