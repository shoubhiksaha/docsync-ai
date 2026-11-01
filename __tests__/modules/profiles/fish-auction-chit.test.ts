import { findField, type RecordField } from '@/modules/profiles';
import { fishAuctionChit as profile } from '@/modules/profiles/fish-auction-chit';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/fish-auction-chit', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds the amount from weight × rate and the net after commission', () => {
      const out = derive([f('weightKg', '186 kg'), f('ratePerKg', '₹210'), f('commission', '₹1,953')]);
      expect(findField(out, ['amount'])?.value).toBe('39060');
      expect(findField(out, ['netPayable'])?.value).toBe('37107');
      expect(out).toHaveLength(5);
    });

    it('converts a weight written in quintals or grams to kg', () => {
      expect(findField(derive([f('weight', '1.86 qtl'), f('ratePerKg', '210')]), ['amount'])?.value).toBe('39060');
      expect(findField(derive([f('weight', '500 g'), f('ratePerKg', '400')]), ['amount'])?.value).toBe('200');
      expect(validate([f('weight', '1.86 qtl'), f('ratePerKg', '210'), f('amount', '39,060')])).toEqual([]);
    });

    it('falls back to baskets × rate per basket', () => {
      const out = derive([f('baskets', '12'), f('ratePerBasket', '1,450')]);
      expect(findField(out, ['amount'])?.value).toBe('17400');
      expect(findField(out, ['netPayable'])).toBeUndefined();
    });

    it('keeps written values and skips missing inputs', () => {
      const stated = [f('weightKg', '10'), f('ratePerKg', '100'), f('amount', '1000'), f('commission', '50'), f('netPayable', '950')];
      expect(derive(stated)).toBe(stated);
      const partial = [f('weightKg', '10'), f('ratePerBasket', '100'), f('commission', '50')];
      expect(derive(partial)).toBe(partial);
    });
  });

  describe('validate', () => {
    const good = [f('weightKg', '186'), f('ratePerKg', '210'), f('amount', '39,060'), f('commission', '1,953'), f('netPayable', '37,107')];
    const with_ = (key: string, value: string) => good.map(x => (x.key === key ? f(key, value) : x));

    it('passes a consistent chit', () => {
      expect(validate(good)).toEqual([]);
    });

    it('warns when weight × rate differs from the amount', () => {
      const fields = [f('weightKg', '186'), f('ratePerKg', '210'), f('amount', '42,000')];
      expect(validate(fields)).toEqual([expect.stringMatching(/doesn't match 186 kg × ₹210 = ₹39,060/)]);
    });

    it('checks baskets × rate per basket too', () => {
      expect(validate([f('baskets', '12'), f('ratePerBasket', '1450'), f('amount', '17,400')])).toEqual([]);
      expect(validate([f('baskets', '12'), f('ratePerBasket', '1450'), f('amount', '15,000')])[0]).toMatch(/12 baskets × ₹1,450/);
    });

    it('warns when net is not amount − commission', () => {
      expect(validate(with_('netPayable', '38,000'))).toEqual([expect.stringMatching(/doesn't equal amount − commission/)]);
    });

    it('flags an unusually high commission', () => {
      const fields = [f('amount', '10,000'), f('commission', '2,500'), f('netPayable', '7,500')];
      expect(validate(fields)).toEqual([expect.stringMatching(/is 25% of the amount/)]);
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('amount', '1000'), f('netPayable', '1')])).toEqual([]);
      expect(validate([f('amount', 'NA'), f('commission', '50'), f('netPayable', '1')])).toEqual([]);
      expect(validate([f('amount', '1000'), f('commission', '50')])).toEqual([]);
    });
  });

  describe('a commission written as a percent', () => {
    it('reads the rupee figure next to it', () => {
      const fields = [f('amount', '₹39,060'), f('commission', '5% (₹1,953)'), f('netPayable', '₹37,107')];
      expect(validate(fields)).toEqual([]);
      expect(findField(derive([f('amount', '₹39,060'), f('commission', '@5% = ₹1,953')]), ['netPayable'])?.value).toBe('37107');
    });
    it('works out a percent on its own from the amount', () => {
      expect(findField(derive([f('amount', '₹39,060'), f('commission', '5%')]), ['netPayable'])?.value).toBe('37107');
      expect(validate([f('amount', '₹39,060'), f('commission', '5%'), f('netPayable', '₹37,107')])).toEqual([]);
      expect(validate([f('amount', '₹39,060'), f('commission', '5%'), f('netPayable', '₹38,000')]))
        .toEqual([expect.stringContaining('₹39,060 − ₹1,953 = ₹37,107')]);
    });
  });
});
