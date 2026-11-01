import { normalizeKey } from '@/core/text';
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
    it('reads a PAN written with its label, as on the sample', () => {
      expect(validateFields(ngo, [f('amount', '₹5,000'), f('donorPanGovtId', 'PAN: ABCDE1234F', 'Donor PAN/Govt. ID')])).toEqual([]);
    });
    it('accepts an Aadhaar (last 4 digits) as the donor ID', () => {
      expect(validateFields(ngo, [f('amount', '₹5,000'), f('panNumber', 'Aadhaar XXXX XXXX 1234', 'Donor PAN/Govt. ID')])).toEqual([]);
      expect(validateFields(ngo, [f('amount', '₹5,000'), f('aadhaarNumber', 'XXXX XXXX 1234')])).toEqual([]);
    });
    it('warns that cash donations above ₹2,000 get no 80G deduction', () => {
      const pan = f('panNumber', 'ABCDE1234F');
      expect(validateFields(ngo, [f('amount', '₹5,000'), f('paymentMode', 'Cash'), pan])).toEqual([
        expect.stringMatching(/Cash donations above ₹2,000 don't get the 80G tax deduction \(₹5,000 recorded in cash\)/),
      ]);
      expect(validateFields(ngo, [f('amount', '₹2,000'), f('paymentMode', 'नकद'), pan])).toEqual([]);
      expect(validateFields(ngo, [f('amount', '₹5,000'), f('paymentMode', 'Cheque'), pan])).toEqual([]);
    });
  });

  it.each(activeProfiles().map(p => [p.id, p] as const))('%s masks an Aadhaar number before it is saved', (_id, p) => {
    const aadhaar: RecordField = { key: 'aadhaarNo', label: 'Aadhaar No', value: '2345 6789 0123', confidence: 90, category: 'identity' };
    const out = deriveFields(p, [...p.mockFields, aadhaar]);
    expect(findField(out, ['aadhaarNo'])?.value).toBe('XXXX XXXX 0123');
    expect(out.map(x => x.value).join(' ')).not.toMatch(/2345\s?6789/);
  });

  it.each(activeProfiles().map(p => [p.id, p] as const))('%s masks an Aadhaar number written in Devanagari digits', (_id, p) => {
    const aadhaar: RecordField = { key: 'idProof', label: 'आधार नंबर', value: '२३४५ ६७८९ ०१२३', confidence: 90, category: 'identity' };
    const out = deriveFields(p, [...p.mockFields, aadhaar]);
    expect(findField(out, ['idProof'])?.value).toBe('XXXX XXXX 0123');
  });

  describe('values written in Devanagari digits', () => {
    const kirana = getProfile('kirana-khata')!;
    const fields = [f('openingBalance', '₹३५०'), f('totalCredit', '₹१,५४०'), f('totalPaid', '₹१,३००')];
    it('are checked like any other value', () => {
      expect(validateFields(kirana, [...fields, f('balanceDue', '₹६९०')])[0]).toMatch(/Balance due \(₹690\).*₹590/);
      expect(validateFields(kirana, [...fields, f('balanceDue', '₹५९०')])).toEqual([]);
    });
    it('feed derived values, and keep the digits they were written in', () => {
      const out = deriveFields(kirana, fields);
      expect(findField(out, ['balanceDue'])?.value).toBe('590');
      expect(out.slice(0, 3)).toEqual(fields);
    });
  });

  it('keeps an e-way bill number that looks like an Aadhaar number', () => {
    const fields = [f('ewayBillNumber', '3612 4578 9012', 'E-way Bill Number')];
    expect(deriveFields(getProfile('lorry-receipt')!, fields)).toBe(fields);
  });

  it.each(activeProfiles().map(p => [p.id, p] as const))('%s mock fields include every priority field', (_id, p) => {
    const names = new Set(p.mockFields.flatMap(m => [normalizeKey(m.key), normalizeKey(m.label)]));
    expect(p.extraction.priorityFields.filter(label => !names.has(normalizeKey(label)))).toEqual([]);
  });

  describe('factory-weight-slip', () => {
    const slip = getProfile('factory-weight-slip')!;
    it('derives net weight in the gross weight\'s unit', () => {
      const out = deriveFields(slip, [f('grossWeight', '15,000 kg'), f('tareWeight', '5000')]);
      expect(findField(out, ['netWeight'])?.value).toBe('10000 kg');
      expect(findField(deriveFields(slip, [f('grossWeight', '24.86 MT'), f('tareWeight', '9340 kg')]), ['netWeight'])?.value).toBe('15.52 MT');
      expect(findField(deriveFields(slip, [f('grossWeight', '24860'), f('tareWeight', '9340')]), ['netWeight'])?.value).toBe('15520');
    });
    it('compares weights in kg across units', () => {
      expect(validateFields(slip, [f('grossWeight', '24.86 MT'), f('tareWeight', '9340 kg'), f('netWeight', '15,520 kg')])).toEqual([]);
      expect(validateFields(slip, [f('grossWeight', '24.86 MT'), f('tareWeight', '9340 kg'), f('netWeight', '15 MT')])[0])
        .toBe("Net weight (15,000 kg) doesn't equal gross − tare (15,520 kg).");
    });
    it('keeps a printed net weight', () => {
      const fields = [f('grossWeight', '15000'), f('tareWeight', '5000'), f('netWeight', '9999')];
      expect(deriveFields(slip, fields)).toBe(fields);
      expect(validateFields(slip, fields)[0]).toMatch(/doesn't equal/);
    });
    it('reads tonnes written in Hindi and keeps the unit on the derived net weight', () => {
      expect(validateFields(slip, [f('grossWeight', '24.86 टन'), f('tareWeight', '9340 kg'), f('netWeight', '15520 kg')])).toEqual([]);
      expect(findField(deriveFields(slip, [f('grossWeight', '24.86 टन'), f('tareWeight', '9340 kg')]), ['netWeight'])?.value).toBe('15.52 टन');
      expect(validateFields(slip, [f('grossWeight', '24 MT 860 kg'), f('tareWeight', '9340 kg'), f('netWeight', '15520')])).toEqual([]);
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
    expect(deriveFields(broken, [f('aadhaar', '2345 6789 0123')])[0].value).toBe('XXXX XXXX 0123');
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
