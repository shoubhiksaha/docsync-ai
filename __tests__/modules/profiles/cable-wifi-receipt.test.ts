import { findField, type RecordField } from '@/modules/profiles';
import { cableWifiReceipt as profile } from '@/modules/profiles/cable-wifi-receipt';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));
const month = f('billingMonth', 'Oct-26');

describe('profiles/cable-wifi-receipt', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds total paid from amount + late fee', () => {
      const out = derive([f('amount', '₹350'), f('lateFee', 'Rs 20')]);
      expect(findField(out, ['totalPaid'])?.value).toBe('₹370');
    });

    it('treats a missing late fee as zero', () => {
      expect(findField(derive([f('amount', '500')]), ['totalPaid'])?.value).toBe('₹500');
    });

    it('keeps a stated total and skips unreadable amounts', () => {
      const stated = [f('amount', '350'), f('totalPaid', '400')];
      expect(derive(stated)).toBe(stated);
      const unreadable = [f('amount', 'paid')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes a consistent receipt', () => {
      expect(validate(profile.mockFields)).toEqual([]);
      expect(validate([month, f('amount', '350'), f('totalPaid', '351')])).toEqual([]);
    });

    it('warns when the total is not amount + late fee', () => {
      expect(validate([month, f('amount', '350'), f('lateFee', '20'), f('totalPaid', '400')])[0])
        .toMatch(/Total paid \(₹400\) doesn't equal amount \+ late fee \(₹350 \+ ₹20 = ₹370\)/);
      expect(validate([month, f('amount', '350'), f('totalPaid', '300')])[0]).toMatch(/₹350 \+ ₹0 = ₹350/);
    });

    it('skips the total check when a value is missing', () => {
      expect(validate([month, f('totalPaid', '370')])).toEqual([]);
    });

    it('warns when the billing month is missing', () => {
      expect(validate([f('amount', '350'), f('totalPaid', '350'), f('billingMonth', '  ')])).toEqual([expect.stringMatching(/No billing month/)]);
    });
  });
  it('uses the total paid, not an amount paid written above it', () => {
    expect(validate([f('amountPaid', '350'), f('planAmount', '350'), f('lateFee', '50'), f('total', '400'), f('billingMonth', 'Oct 2026')])).toEqual([]);
  });

  describe('a payment for several months', () => {
    it('multiplies the amount by "× 2 months"', () => {
      expect(validate([f('amount', '₹350 x 2 months'), f('totalPaid', '₹700'), month])).toEqual([]);
      expect(findField(derive([f('amount', '₹350 × 2 months'), f('lateFee', '₹20')]), ['totalPaid'])?.value).toBe('₹720');
    });
    it('uses a Months Paid field', () => {
      expect(validate([f('amount', '₹350'), f('monthsPaid', '3'), f('lateFee', '₹20'), f('totalPaid', '₹1,070'), month])).toEqual([]);
      expect(findField(derive([f('amount', '₹350'), f('monthsPaid', '3')]), ['totalPaid'])?.value).toBe('₹1,050');
      expect(validate([f('amount', '₹350'), f('monthsPaid', '3'), f('totalPaid', '₹350'), month]))
        .toEqual([expect.stringContaining('(₹350 × 3 + ₹0 = ₹1,050)')]);
    });
    it('counts a range in the billing month, which may already be in the amount', () => {
      for (const period of ['Sep–Oct 2026', 'September to October', 'सितंबर-अक्टूबर', 'Sep, Oct']) {
        expect(validate([f('amount', '₹350'), f('totalPaid', '₹700'), f('billingMonth', period)])).toEqual([]);
      }
      expect(validate([f('amount', '₹700'), f('totalPaid', '₹700'), f('billingMonth', 'Sep–Oct')])).toEqual([]);
      expect(validate([f('amount', '₹350'), f('totalPaid', '₹1,050'), f('billingMonth', 'Dec 2026 - Feb 2027')])).toEqual([]);
      expect(validate([f('amount', '₹350'), f('totalPaid', '₹500'), f('billingMonth', 'Sep–Oct')]))
        .toEqual([expect.stringContaining('(₹350 × 2 + ₹0 = ₹700)')]);
      expect(findField(derive([f('amount', '₹350'), f('billingMonth', 'Sep–Oct')]), ['totalPaid'])?.value).toBe('₹350');
    });
  });
});
