import { findField, type RecordField } from '@/modules/profiles';
import { streetVendorDailyFinance as profile } from '@/modules/profiles/street-vendor-daily-finance';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);

describe('profiles/street-vendor-daily-finance', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  it('has no default duplicate check (the same card is scanned every day)', () => {
    expect(profile.duplicateKey).toBeUndefined();
  });

  describe('derive', () => {
    it('adds balance from loan amount − total paid', () => {
      const out = derive([f('loanAmount', '₹10,000'), f('totalPaid', 'Rs 6,200/-')]);
      expect(findField(out, ['balance'])?.value).toBe('3800');
    });

    it('keeps a stated balance and skips missing or unreadable inputs', () => {
      const stated = [f('loanAmount', '10000'), f('totalPaid', '6200'), f('baki', '3800')];
      expect(derive(stated)).toBe(stated);
      const missing = [f('loanAmount', '10000')];
      expect(derive(missing)).toBe(missing);
      const unreadable = [f('chitAmount', 'one lakh'), f('totalPaid', '500')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes a consistent card', () => {
      expect(validate(profile.mockFields)).toEqual([]);
      expect(validate([f('loanAmount', '10000'), f('totalPaid', '6200'), f('balance', '3801'), f('phone', '+91 98765-43310')])).toEqual([]);
    });

    it('warns when balance is not loan − total paid', () => {
      expect(validate([f('loanAmount', '10000'), f('totalPaid', '6200'), f('balance', '4000')])[0])
        .toMatch(/Balance \(₹4,000\) doesn't equal loan amount − total paid \(₹10,000 − ₹6,200 = ₹3,800\)/);
    });

    it('warns on a short payment', () => {
      expect(validate([f('dailyInstalment', '₹100'), f('amountPaidToday', '₹80')])[0]).toMatch(/Short payment: ₹80 paid today .*₹100 \(₹20 short\)/);
      expect(validate([f('dailyInstalment', '₹100'), f('amountPaidToday', '₹200')])).toEqual([]);
      expect(validate([f('dailyInstalment', '₹100')])).toEqual([]);
    });

    it('warns when days paid exceed the total days', () => {
      expect(validate([f('daysPaid', '102 / 100')])[0]).toMatch(/Days paid \(102\) is more than the total days \(100\)/);
      expect(validate([f('daysPaid', '30'), f('totalDays', '25')])[0]).toMatch(/\(30\).*\(25\)/);
      expect(validate([f('daysPaid', '62 of 100')])).toEqual([]);
      expect(validate([f('daysPaid', '62')])).toEqual([]);
    });

    it('warns on a malformed phone number', () => {
      expect(validate([f('mobile', '5555 12345')])[0]).toMatch(/Phone "555512345"/);
    });
  });
});
