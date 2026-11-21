import { normalizeKey } from '@/core/text';

/**
 * Value of the field named by the earliest of `keys` that is filled in. The keys are in order of
 * preference (a farmer's name before their member code), whatever order the slip lists them in.
 */
export function preferredValue(fields: readonly { key: string; label: string; value: string }[], keys: readonly string[]): string | undefined {
  for (const key of keys.map(normalizeKey)) {
    const value = fields.find(f => normalizeKey(f.key) === key || normalizeKey(f.label) === key)?.value?.trim();
    if (value) return value;
  }
  return undefined;
}
