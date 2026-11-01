import fs from 'fs';
import path from 'path';
import { findField, PROFILE_GROUPS, ruleMessage, type DocumentProfile, type RecordField, type RuleWarning } from '@/modules/profiles';

const CATEGORIES = ['identity', 'financial', 'date', 'contact', 'metadata', 'other'];
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Everything a document profile must satisfy to work with the shared modules (extraction, review,
 * Sheets, Notion, home page). Returns the broken rules, so `expect(profileProblems(p)).toEqual([])`
 * names each one.
 */
export function profileProblems(p: DocumentProfile): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, rule: string) => { if (!ok) problems.push(rule); };

  check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id), 'id is kebab-case');
  check((PROFILE_GROUPS as readonly string[]).includes(p.group), `group is one of ${PROFILE_GROUPS.join(', ')}`);
  check(/^\w{1,40}$/.test(p.sheetTab), 'sheetTab is 1-40 letters, digits or underscores');
  check(p.sheetTitle.startsWith('DocSync — '), "sheetTitle starts with 'DocSync — '");
  for (const key of ['title', 'documentName', 'description'] as const) {
    check(Boolean(p[key]?.trim()), `${key} is set`);
    check(DEVANAGARI.test(p.translations?.hi?.[key] ?? ''), `Hindi ${key} is set`);
  }
  check(p.extraction.context.length >= 80, 'extraction.context describes the document');
  check(p.extraction.priorityFields.length >= 4, 'at least 4 priority fields');

  const keys = p.mockFields.map(f => f.key);
  check(p.mockFields.length >= 5, 'at least 5 mock fields');
  check(new Set(keys).size === keys.length, 'mock field keys are unique');
  for (const f of p.mockFields) {
    check(/^[a-z][a-zA-Z0-9]*$/.test(f.key), `mock field ${f.key} has a camelCase key`);
    check(Boolean(f.label?.trim() && f.value?.trim()), `mock field ${f.key} has a label and a value`);
    check(typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 100, `mock field ${f.key} has a confidence of 0-100`);
    check(CATEGORIES.includes(String(f.category)), `mock field ${f.key} has a known category`);
  }

  let fields: RecordField[] = p.mockFields;
  try {
    fields = p.derive ? p.derive(p.mockFields) : p.mockFields;
    check(keys.every(k => fields.some(f => f.key === k)), 'derive() keeps every field it was given');
  } catch (err) {
    problems.push(`derive() throws on the mock fields: ${String(err)}`);
  }
  if (p.duplicateKey) check(fields.some(f => f.key === p.duplicateKey), 'duplicateKey is a mock field or one derive() adds');
  try {
    const warnings = p.validate ? p.validate(fields) : [];
    check(warnings.length === 0, `validate() passes the mock fields (got: ${warnings.map(w => w.code).join(' | ')})`);
  } catch (err) {
    problems.push(`validate() throws on the mock fields: ${String(err)}`);
  }

  check(Boolean(findField(fields, p.notion.titleFrom)), 'notion.titleFrom matches a mock field');
  if (p.notion.dateFrom.length) check(Boolean(findField(fields, p.notion.dateFrom)), 'notion.dateFrom matches a mock field');
  check(p.notion.properties.length <= 3, 'at most 3 Notion properties (one shared database holds every app)');
  for (const prop of p.notion.properties) {
    check(Boolean(findField(fields, prop.from)), `Notion property "${prop.name}" matches a mock field`);
  }

  check(Boolean(p.sampleDocument), 'has a sample document');
  if (p.sampleDocument) {
    check(fs.existsSync(path.join(process.cwd(), 'public', p.sampleDocument.href)), `sample ${p.sampleDocument.href} exists in public/`);
  }
  return problems;
}

/**
 * Warnings as the English sentences the user sees. Throws when a warning's message is missing or
 * leaves a {placeholder} unfilled, in English or Hindi.
 */
export function ruleTexts(warnings: RuleWarning[]): string[] {
  return warnings.map(w => {
    for (const lang of ['en', 'hi'] as const) {
      const text = ruleMessage(w, lang);
      if (text.startsWith('rule.') || /\{\w+\}/.test(text)) throw new Error(`Unfilled ${lang} message for ${w.code}: ${text}`);
    }
    return ruleMessage(w);
  });
}
