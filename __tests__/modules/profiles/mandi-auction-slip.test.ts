import { findField, type RecordField } from '@/modules/profiles';
import { mandiAuctionSlip as profile } from '@/modules/profiles/mandi-auction-slip';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);

describe('profiles/mandi-auction-slip', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('reads a weight written in quintals and kg, in English or Hindi', () => {
      for (const weight of ['18 क्विंटल 60 किलो', '18 qtl 60 kg', '1860 kg', '18.6']) {
        expect(findField(derive([f('weight', weight), f('rate', '4850')]), ['grossAmount'])?.value).toBe('90210');
      }
      expect(validate([f('weight', '18 क्विंटल 60 किलो'), f('rate', '4850'), f('grossAmount', '90,210')])).toEqual([]);
    });

    it('adds the gross amount from weight × rate and the net payable from itemised deductions', () => {
      const out = derive([
        f('weightQuintals', '18.60 qtl'), f('ratePerQuintal', '₹4,850'),
        f('marketFee', '902'), f('commission', '1,804'), f('labour', '279'),
      ]);
      expect(findField(out, ['grossAmount'])?.value).toBe('90210');
      expect(findField(out, ['netPayable'])?.value).toBe('87225');
      expect(out).toHaveLength(7);
    });

    it('converts a weight written in kg to quintals', () => {
      const out = derive([f('weight', '1,860 kg'), f('rate', '4850')]);
      expect(findField(out, ['grossAmount'])?.value).toBe('90210');
    });

    it('keeps quintals when both units are written', () => {
      const out = derive([f('weight', '18.6 Qntl (1860 kg)'), f('rate', '4850')]);
      expect(findField(out, ['grossAmount'])?.value).toBe('90210');
    });

    it('uses a written total deduction and keeps stated amounts', () => {
      const fields = [f('grossAmount', '1000'), f('totalDeductions', '50')];
      expect(findField(derive(fields), ['netPayable'])?.value).toBe('950');
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
      expect(findField(derive([f('weight', '1,860'), f('rate', '2400')]), ['grossAmount'])?.value).toBe('44640');
      expect(findField(derive([f('weightQuintals', '1860', 'Weight (Quintals)'), f('rate', '2400')]), ['grossAmount'])?.value).toBe('44640');
    });
    it('is kg when only kg makes weight × rate match the gross', () => {
      expect(validate([f('weight', '350'), f('rate', '₹2,400'), f('grossAmount', '₹8,400')])).toEqual([]);
      expect(validate([f('weight', '35'), f('rate', '₹2,400'), f('grossAmount', '₹84,000')])).toEqual([]);
    });
    it('is quintals otherwise', () => {
      expect(validate([f('weight', '18.6'), f('rate', '4850'), f('grossAmount', '50,000')])[0]).toMatch(/18.6 qtl × ₹4,850 = ₹90,210/);
    });
  });
});
