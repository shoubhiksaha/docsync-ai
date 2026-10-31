import { profileProblems } from '../helpers/profile-contract';
import {
  PROFILE_GROUPS,
  activeProfiles,
  comingSoonProfiles,
  deriveFields,
  findField,
  getProfile,
  localizedComingSoon,
  localizedProfile,
  notionPropertyUnion,
  validateFields,
  type DocumentProfile,
  type RecordField,
} from '@/modules/profiles';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });

describe('modules/profiles', () => {
  it('registers all 28 document apps, with nothing left in coming-soon', () => {
    expect(activeProfiles()).toHaveLength(28);
    expect(getProfile('ngo-receipt')?.id).toBe('ngo-receipt');
    expect(getProfile('muster-roll')?.id).toBe('muster-roll');
    expect(comingSoonProfiles).toEqual([]);
    expect(getProfile('nope')).toBeUndefined();
    expect(getProfile(null)).toBeUndefined();
  });

  it.each(activeProfiles().map(p => [p.id, p] as const))('%s meets the profile contract', (_id, p) => {
    expect(profileProblems(p)).toEqual([]);
  });

  it('keeps ids, sheet tabs and sample files unique, and fills every home-page group', () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(activeProfiles().map(p => p.id))).toBe(true);
    expect(unique(activeProfiles().map(p => p.sheetTab.toLowerCase()))).toBe(true);
    expect(unique(activeProfiles().map(p => p.sampleDocument?.href ?? p.id))).toBe(true);
    for (const group of PROFILE_GROUPS) expect(activeProfiles().some(p => p.group === group)).toBe(true);
  });

  it('gives each Notion property one type across apps (they share one database)', () => {
    const types = new Map<string, Set<string>>();
    for (const p of activeProfiles()) {
      for (const prop of p.notion.properties) types.set(prop.name, (types.get(prop.name) ?? new Set()).add(prop.type));
    }
    const clashes = [...types].filter(([, t]) => t.size > 1).map(([name, t]) => `${name}: ${[...t].join('/')}`);
    expect(clashes).toEqual([]);
  });

  it('findField matches by key or label, ignoring case and punctuation', () => {
    const fields = [f('donor_name', 'Asha', 'Donor Name')];
    expect(findField(fields, ['donorName'])?.value).toBe('Asha');
    expect(findField(fields, ['DONOR NAME'])?.value).toBe('Asha');
    expect(findField(fields, ['pan'])).toBeUndefined();
  });

  describe('ngo-receipt', () => {
    const ngo = getProfile('ngo-receipt')!;
    it('warns when a large donation has no PAN', () => {
      expect(validateFields(ngo, [f('amount', '₹5,000')])[0]).toMatch(/PAN/);
    });
    it('warns on a malformed PAN', () => {
      expect(validateFields(ngo, [f('amount', '500'), f('panNumber', 'ABC123')])[0]).toMatch(/doesn't match/);
    });
    it('passes a valid receipt', () => {
      expect(validateFields(ngo, [f('amount', '₹5,000'), f('panNumber', 'abcde 1234f')])).toEqual([]);
    });
  });

  describe('factory-weight-slip', () => {
    const slip = getProfile('factory-weight-slip')!;
    it('derives net weight', () => {
      const out = deriveFields(slip, [f('grossWeight', '15,000 kg'), f('tareWeight', '5000')]);
      expect(findField(out, ['netWeight'])?.value).toBe('10000');
    });
    it('keeps a printed net weight', () => {
      const fields = [f('grossWeight', '15000'), f('tareWeight', '5000'), f('netWeight', '9999')];
      expect(deriveFields(slip, fields)).toBe(fields);
      expect(validateFields(slip, fields)[0]).toMatch(/doesn't equal/);
    });
    it('flags tare >= gross', () => {
      expect(validateFields(slip, [f('grossWeight', '100'), f('tareWeight', '200')])[0]).toMatch(/not less than/);
    });
    it('does nothing without numbers', () => {
      const fields = [f('grossWeight', 'n/a')];
      expect(deriveFields(slip, fields)).toBe(fields);
      expect(validateFields(slip, fields)).toEqual([]);
    });
  });

  it('a crashing validator or derive() is contained', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      ...getProfile('ngo-receipt')!,
      validate: () => { throw new Error('bug'); },
      derive: () => { throw new Error('bug'); },
    } as DocumentProfile;
    const fields = [f('a', '1')];
    expect(validateFields(broken, fields)[0]).toMatch(/unavailable/);
    expect(deriveFields(broken, fields)).toBe(fields);
  });

  it('collects every Notion property used by any profile', () => {
    const names = notionPropertyUnion().map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['Amount', 'PAN', 'Gross Weight', 'Tare Weight', 'Net Weight']));
  });

  it('a duplicate-check field, where a profile has one, is a field it actually extracts', () => {
    for (const p of activeProfiles().filter(p => p.duplicateKey)) {
      expect(p.mockFields.map(m => m.key)).toContain(p.duplicateKey);
    }
    // Registers and passbooks have no unique number, so these leave the duplicate check to the user.
    expect(getProfile('muster-roll')?.duplicateKey).toBeUndefined();
  });

  it('localizes profile copy, falling back to English', () => {
    const ngo = getProfile('ngo-receipt')!;
    expect(localizedProfile(ngo, 'en')).toEqual({ title: ngo.title, documentName: ngo.documentName, description: ngo.description });
    expect(localizedProfile(ngo, 'hi').title).toMatch(/[\u0900-\u097F]/);
    const untranslated = { ...ngo, translations: undefined } as DocumentProfile;
    expect(localizedProfile(untranslated, 'hi').title).toBe(ngo.title);

    for (const item of comingSoonProfiles) {
      expect(item.hi?.title).toMatch(/[\u0900-\u097F]/);
      expect(localizedComingSoon(item, 'hi')).toEqual(item.hi);
      expect(localizedComingSoon(item, 'en')).toEqual({ title: item.title, description: item.description });
    }
    expect(localizedComingSoon({ title: 'T', description: 'D' }, 'hi')).toEqual({ title: 'T', description: 'D' });
  });
});
