import { findField, type RecordField } from '@/modules/profiles';
import { godownStorageReceipt } from '@/modules/profiles/godown-storage-receipt';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => godownStorageReceipt.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(godownStorageReceipt.validate!(fields));

describe('profiles/godown-storage-receipt', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(godownStorageReceipt)).toEqual([]);
  });

  describe('derive()', () => {
    it('adds the weight in kg from quintals, tonnes or kg', () => {
      expect(findField(derive([f('weight', '62.50 Qtl')]), ['weightKg'])?.value).toBe('6250');
      expect(findField(derive([f('weight', '6.25MT')]), ['weightKg'])?.value).toBe('6250');
      expect(findField(derive([f('weight', '62.5Qtl')]), ['weightKg'])?.value).toBe('6250');
      expect(findField(derive([f('netWeight', '40 क्विंटल')]), ['weightKg'])?.value).toBe('4000');
      expect(findField(derive([f('weight', '2,500 kg')]), ['weightKg'])?.value).toBe('2500');
      expect(findField(derive([f('weight', '62 कुंतल 50 किलो')]), ['weightKg'])?.value).toBe('6250');
      expect(findField(derive([f('weight', '6.25 टन')]), ['weightKg'])?.value).toBe('6250');
    });
    it('does not guess a unit or overwrite a stated kg weight', () => {
      const noUnit = [f('weight', '62.5')];
      expect(derive(noUnit)).toEqual(noUnit);
      const stated = [f('weight', '62.5 Qtl'), f('weightKg', '6250')];
      expect(derive(stated)).toEqual(stated);
      const unreadable = [f('weight', 'Qtl')];
      expect(derive(unreadable)).toEqual(unreadable);
      expect(derive([])).toEqual([]);
    });
    it('masks a full Aadhaar number to its last 4 digits', () => {
      const out = derive([f('aadhaarNumber', '2345 6789 0123'), f('x', '9876-5432-1012', 'आधार नं.'), f('adharNo', '234567890123')]);
      expect(out.map(x => x.value)).toEqual(['XXXX XXXX 0123', 'XXXX XXXX 1012', 'XXXX XXXX 0123']);
      expect(out.map(x => x.key)).toEqual(['aadhaarNumber', 'x', 'adharNo']);
    });
    it('leaves already-masked Aadhaar values and other 12-digit numbers alone', () => {
      const fields = [f('aadhaar', 'XXXX XXXX 0123'), f('accountNumber', '123456789012')];
      expect(derive(fields)).toEqual(fields);
    });
  });

  describe('dates', () => {
    it('accepts a valid-until date after the deposit date in common formats', () => {
      expect(validate([f('depositDate', '15-10-2026'), f('validUntil', '14/04/27')])).toEqual([]);
      expect(validate([f('depositDate', '2026-10-15'), f('validUntil', '14 Apr 2027')])).toEqual([]);
      expect(validate([f('depositDate', '15.10.2026'), f('validTill', '14-April-2027')])).toEqual([]);
    });
    it('flags a valid-until date on or before the deposit date', () => {
      expect(validate([f('depositDate', '15-10-2026'), f('validUntil', '14-04-2026')])[0])
        .toBe('Valid-until date (14-04-2026) is not after the deposit date (15-10-2026). Please check the dates.');
      expect(validate([f('depositDate', '15-10-2026'), f('validUntil', '15 Oct 2026')])).toHaveLength(1);
    });
    it('ignores impossible or unreadable dates', () => {
      expect(validate([f('depositDate', '31-02-2026'), f('validUntil', '01-01-2020')])).toEqual([]);
      expect(validate([f('depositDate', '15 Foo 2026'), f('validUntil', '01-01-2020')])).toEqual([]);
      expect(validate([f('depositDate', 'Diwali'), f('validUntil', '01-01-2020')])).toEqual([]);
      expect(validate([f('depositDate', '15-10-2026')])).toEqual([]);
    });
  });

  describe('weight per bag', () => {
    it('accepts 25–100 kg a bag', () => {
      expect(validate([f('bags', '125'), f('weight', '62.50 Qtl')])).toEqual([]);
      expect(validate([f('bags', '100'), f('weight', '10 MT')])).toEqual([]);
    });
    it('flags an implausible weight per bag when the unit is known', () => {
      expect(validate([f('bags', '125'), f('weight', '625 Qtl')])[0])
        .toMatch(/500 kg per bag \(usually 25–100 kg a bag\)/);
      expect(validate([f('bags', '125'), f('weight', '625 kg')])[0]).toMatch(/5 kg per bag/);
    });
    it('without a unit, accepts any reading that is plausible', () => {
      expect(validate([f('bags', '125'), f('weight', '62.5')])).toEqual([]);
      expect(validate([f('bags', '125'), f('weight', '6250')])).toEqual([]);
      expect(validate([f('bags', '125'), f('weight', '1')])[0]).toMatch(/1 for 125 bags/);
    });
    it('skips the check without bags or weight', () => {
      expect(validate([f('bags', '0'), f('weight', '62.5 Qtl')])).toEqual([]);
      expect(validate([f('bags', '125')])).toEqual([]);
    });
  });

  describe('storage charges', () => {
    const base = [f('bags', '125'), f('weight', '62.50 Qtl')];
    const charges = (rate: string, period: string, amount: string, extra = base) =>
      validate([...extra, f('storageRate', rate), f('storagePeriod', period), f('storageCharges', amount)]);

    it('accepts charges that match rate × quintals × months', () => {
      expect(charges('₹12 per qtl per month', '6 months', '₹4,500')).toEqual([]);
    });
    it('flags charges that do not match and shows the working', () => {
      expect(charges('₹12 per qtl per month', '6 months', '₹4,000')[0])
        .toBe("Storage charges (₹4,000) don't match rate × quantity × period (12 × 62.5 qtl × 6 months = ₹4,500). Please check.");
    });
    it('charges per bag', () => {
      expect(charges('₹5 per bag per month', '6 months', '3750')).toEqual([]);
      expect(charges('₹5/बोरी', '6 months', '3000')[0]).toMatch(/5 × 125 bags × 6 months = ₹3,750/);
      expect(charges('₹5 per bag', '6 months', '3000', [f('weight', '62.5 Qtl')])).toEqual([]);
    });
    it('converts the weight to the rate basis', () => {
      expect(charges('₹120 per MT per month', '6 months', '4500')).toEqual([]);
      expect(charges('₹12 per qtl per month', '6 months', '4500', [f('weight', '6.25 MT')])).toEqual([]);
      expect(charges('₹12 per month', '6 months', '4500')).toEqual([]);
      expect(charges('₹12 per qtl per month', '6 months', '4500', [f('weight', '62.5')])).toEqual([]);
    });
    it('uses the weight as written when neither unit is known', () => {
      expect(charges('₹12 per month', '6 months', '4500', [f('weight', '62.5')])).toEqual([]);
      expect(charges('₹12 per month', '6 months', '4000', [f('weight', '62.5')])[0]).toMatch(/12 × 62.5 × 6 months/);
    });
    it('reads periods in days or years and yearly rates', () => {
      expect(charges('₹12 per qtl per month', '180 days', '4500')).toEqual([]);
      expect(charges('₹12 per qtl per month', '1 year', '9000')).toEqual([]);
      expect(charges('₹144 per qtl per annum', '6 months', '4500')).toEqual([]);
      expect(charges('₹144 per qtl per annum', '6 months', '9000')[0]).toMatch(/6 months ÷ 12 = ₹4,500/);
    });
    it('skips seasonal or daily rates and missing values', () => {
      expect(charges('₹40 per bag per season', '6 months', '100')).toEqual([]);
      expect(charges('₹0.5 per qtl per day', '6 months', '100')).toEqual([]);
      expect(charges('as per rules', '6 months', '100')).toEqual([]);
      expect(charges('₹12 per month', '6 months', '100', [f('bags', '125')])).toEqual([]);
      expect(validate([...base, f('storageRate', '₹12 per qtl per month'), f('storageCharges', '100')])).toEqual([]);
    });
  });

  it('returns nothing for an empty record', () => {
    expect(validate([])).toEqual([]);
  });
});
