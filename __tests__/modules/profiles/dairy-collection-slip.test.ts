import { findField, type RecordField } from '@/modules/profiles';
import { dairyCollectionSlip as profile } from '@/modules/profiles/dairy-collection-slip';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/dairy-collection-slip', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  it('has no default duplicate check (a slip carries no unique number)', () => {
    expect(profile.duplicateKey).toBeUndefined();
  });

  describe('derive', () => {
    it('adds the amount from quantity × rate', () => {
      const out = derive([f('quantityLitres', '6.4 L'), f('ratePerLitre', '₹47.60')]);
      expect(findField(out, ['amount'])?.value).toBe('304.64');
      expect(out).toHaveLength(3);
    });

    it('keeps a printed amount', () => {
      const fields = [f('quantityLitres', '6.4'), f('ratePerLitre', '47.60'), f('amount', '300')];
      expect(derive(fields)).toBe(fields);
    });

    it('returns the fields unchanged when quantity or rate is unreadable', () => {
      const fields = [f('quantityLitres', 'six'), f('ratePerLitre', '47.60')];
      expect(derive(fields)).toBe(fields);
    });
  });

  describe('validate', () => {
    const base = [f('milkType', 'Buffalo'), f('quantityLitres', '6.4'), f('ratePerLitre', '47.60'), f('amount', '304.64'), f('fatPercent', '6.8'), f('snfPercent', '9.0')];
    const with_ = (key: string, value: string) => base.map(x => (x.key === key ? f(key, value) : x));

    it('passes a consistent slip', () => {
      expect(validate(base)).toEqual([]);
    });

    it('warns when quantity × rate differs from the amount', () => {
      expect(validate(with_('amount', '340'))).toEqual([expect.stringMatching(/doesn't match quantity × rate .*₹304.64/)]);
    });

    it('allows paise rounding', () => {
      expect(validate(with_('amount', '305'))).toEqual([]);
    });

    it('checks fat against the buffalo range', () => {
      expect(validate(with_('fatPercent', '13.5'))[0]).toMatch(/Fat 13.5% is outside the usual 4–12% for buffalo milk/);
      expect(validate(with_('fatPercent', '3.2'))[0]).toMatch(/4–12%/);
    });

    it('checks fat against the cow range, including short codes and Hindi', () => {
      const cow = [f('milkType', 'C'), f('fatPercent', '8.5')];
      expect(validate(cow)[0]).toMatch(/2.5–7% for cow milk\. Check the fat reading and the milk type/);
      expect(validate([f('milkType', 'गाय'), f('fatPercent', '4.1')])).toEqual([]);
      expect(validate([f('milkType', 'भैंस'), f('fatPercent', '8.5')])).toEqual([]);
    });

    it('uses the wide mixed range when the milk type is unknown or mixed', () => {
      expect(validate([f('fatPercent', '8.5')])).toEqual([]);
      expect(validate([f('milkType', 'Cow + Buffalo'), f('fatPercent', '1.5')])[0]).toMatch(/2.5–12% for mixed milk\. Check the fat reading\.$/);
    });

    it('warns on an implausible SNF', () => {
      expect(validate(with_('snfPercent', '12'))).toEqual([expect.stringMatching(/SNF 12% is outside the usual 7–10.5%/)]);
      expect(validate(with_('snfPercent', '6.2'))).toHaveLength(1);
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('quantityLitres', '6.4'), f('amount', '304.64'), f('fatPercent', 'n/a'), f('snfPercent', '-')])).toEqual([]);
    });
  });
});
