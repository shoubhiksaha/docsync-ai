import { findField, type RecordField } from '@/modules/profiles';
import { mandiAuctionSlip as profile } from '@/modules/profiles/mandi-auction-slip';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/mandi-auction-slip', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('reads a weight written in quintals and kg, in English or Hindi', () => {
      for (const weight of ['18 क्विंटल 60 किलो', '18 qtl 60 kg', '1860 kg', '18.6']) {
        expect(findField(derive([f('weight', weight), f('rate', '4850')]), ['grossAmount'])?.value).toBe('₹90,210');
      }
      expect(validate([f('weight', '18 क्विंटल 60 किलो'), f('rate', '4850'), f('grossAmount', '90,210')])).toEqual([]);
    });

    it('adds the gross amount from weight × rate and the net payable from itemised deductions', () => {
      const out = derive([
        f('weightQuintals', '18.60 qtl'), f('ratePerQuintal', '₹4,850'),
        f('marketFee', '902'), f('commission', '1,804'), f('labour', '279'),
      ]);
      expect(findField(out, ['grossAmount'])?.value).toBe('₹90,210');
      expect(findField(out, ['netPayable'])?.value).toBe('₹87,225');
      expect(out).toHaveLength(7);
    });

    it('converts a weight written in kg to quintals', () => {
      const out = derive([f('weight', '1,860 kg'), f('rate', '4850')]);
      expect(findField(out, ['grossAmount'])?.value).toBe('₹90,210');
    });

    it('keeps quintals when both units are written', () => {
      const out = derive([f('weight', '18.6 Qntl (1860 kg)'), f('rate', '4850')]);
      expect(findField(out, ['grossAmount'])?.value).toBe('₹90,210');
    });

    it('uses a written total deduction and keeps stated amounts', () => {
      const fields = [f('grossAmount', '1000'), f('totalDeductions', '50')];
      expect(findField(derive(fields), ['netPayable'])?.value).toBe('₹950');
      const stated = [f('grossAmount', '1000'), f('totalDeductions', '50'), f('netPayable', '940')];
      expect(derive(stated)).toBe(stated);
    });

    it('returns the fields unchanged when inputs are missing or unreadable', () => {
      const fields = [f('weightQuintals', 'n/a'), f('ratePerQuintal', '4850')];
      expect(derive(fields)).toBe(fields);
      const noDeductions = [f('grossAmount', '1000')];
      expect(derive(noDeductions)).toBe(noDeductions);
    });
  });

  describe('validate', () => {
    const good = [
      f('weightQuintals', '18.60'), f('ratePerQuintal', '4850'), f('grossAmount', '90,210'),
      f('totalDeductions', '2,985'), f('netPayable', '87,225'),
    ];

    it('passes a consistent slip', () => {
      expect(validate(good)).toEqual([]);
    });

    it('warns when weight × rate differs from the gross amount', () => {
      const fields = good.map(x => (x.key === 'grossAmount' ? f('grossAmount', '95,000') : x));
      expect(validate(fields)[0]).toMatch(/doesn't match weight × rate .*₹90,210/);
    });

    it('allows small rounding in weight × rate', () => {
      expect(validate([f('weightQuintals', '18.60'), f('ratePerQuintal', '4850'), f('grossAmount', '90,400')])).toEqual([]);
    });

    it('warns when net payable is not gross − deductions', () => {
      const fields = good.map(x => (x.key === 'netPayable' ? f('netPayable', '88,000') : x));
      expect(validate(fields)).toEqual([expect.stringMatching(/doesn't equal gross − deductions/)]);
    });

    it('checks the net against itemised deductions too', () => {
      const fields = [f('grossAmount', '1000'), f('marketFee', '10'), f('hammali', '20', 'Hammali'), f('netPayable', '970')];
      expect(validate(fields)).toEqual([]);
      expect(validate([...fields.slice(0, 3), f('netPayable', '990')])).toHaveLength(1);
    });

    it('warns when net payable is more than the gross amount', () => {
      expect(validate([f('grossAmount', '1000'), f('netPayable', '1200')])[0]).toMatch(/more than the gross/);
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('grossAmount', '1000'), f('netPayable', '900')])).toEqual([]);
      expect(validate([f('weightQuintals', '-'), f('ratePerQuintal', '4850'), f('grossAmount', '1')])).toEqual([]);
    });
  });

  describe('a weight written without a unit', () => {
    it('is kg above 500, so no ₹44 lakh gross is worked out', () => {
      expect(validate([f('weight', '1860'), f('rate', '₹2,400'), f('grossAmount', '₹44,640')])).toEqual([]);
      expect(findField(derive([f('weight', '1,860'), f('rate', '2400')]), ['grossAmount'])?.value).toBe('₹44,640');
      expect(findField(derive([f('weightQuintals', '1860', 'Weight (Quintals)'), f('rate', '2400')]), ['grossAmount'])?.value).toBe('₹44,640');
    });
    it('is kg when only kg makes weight × rate match the gross', () => {
      expect(validate([f('weight', '350'), f('rate', '₹2,400'), f('grossAmount', '₹8,400')])).toEqual([]);
      expect(validate([f('weight', '35'), f('rate', '₹2,400'), f('grossAmount', '₹84,000')])).toEqual([]);
    });
    it('is quintals otherwise', () => {
      expect(validate([f('weight', '18.6'), f('rate', '4850'), f('grossAmount', '50,000')])[0]).toMatch(/18.6 qtl × ₹4,850 = ₹90,210/);
    });
  });

  describe('a rate that is not per quintal', () => {
    const value = (fields: RecordField[], key: string) => findField(derive(fields), [key])?.value;

    it('multiplies the weight in kg by a rate per kg', () => {
      const fields = [f('weight', '500 kg'), f('rate', '₹24 per kg'), f('totalDeductions', '₹300')];
      expect(value(fields, 'grossAmount')).toBe('₹12,000');
      expect(value(fields, 'netPayable')).toBe('₹11,700');
      expect(value([f('weight', '5 qtl'), f('bhav', '₹24/किलो')], 'grossAmount')).toBe('₹12,000');
      expect(value([f('weight', '500'), f('rate', '24', 'Rate per kg')], 'grossAmount')).toBe('₹12,000');
      expect(validate([f('weight', '500 kg'), f('rate', '₹24/kg'), f('grossAmount', '₹12,000')])).toEqual([]);
    });
    it('warns in the rate\'s own unit', () => {
      expect(validate([f('weight', '500 kg'), f('rate', '₹24/kg'), f('grossAmount', '₹14,000')]))
        .toEqual([expect.stringContaining("doesn't match 500 kg × ₹24/kg = ₹12,000")]);
    });
    it('multiplies crates by a rate per crate, and skips it with no count', () => {
      expect(value([f('crates', '40'), f('weight', '800 kg'), f('rate', '₹450 per crate')], 'grossAmount')).toBe('₹18,000');
      const noCount = [f('weight', '800 kg'), f('rate', '₹450 per crate')];
      expect(derive(noCount)).toBe(noCount);
      expect(validate([...noCount, f('grossAmount', '₹18,000')])).toEqual([]);
    });
  });

  describe('a deduction written as a percent', () => {
    it('is worked out on the gross, and a written rupee figure wins', () => {
      const fields = [f('grossAmount', '90,210'), f('marketFee', '1.5%'), f('commission', '2% ₹1,804')];
      expect(findField(derive(fields), ['netPayable'])?.value).toBe('₹87,052.85');
      expect(validate([...fields, f('netPayable', '87,053')])).toEqual([]);
      expect(validate([f('grossAmount', '90,210'), f('totalDeductions', '3.5%'), f('netPayable', '87,053')])).toEqual([]);
    });
    it('makes the deductions unknown when there is no gross to work it out on', () => {
      const fields = [f('marketFee', '1.5%'), f('labour', '279')];
      expect(derive(fields)).toBe(fields);
    });
  });
});
