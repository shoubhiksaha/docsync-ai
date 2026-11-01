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

    it('includes interest: balance is instalment × total days − total paid', () => {
      const card = [f('loanAmount', '₹10,000'), f('dailyInstalment', '₹120'), f('totalPaid', '₹7,440'), f('daysPaid', '62 / 100')];
      expect(findField(derive(card), ['balance'])?.value).toBe('4560');
      expect(findField(derive([...card.slice(0, 3), f('totalDays', '100')]), ['balance'])?.value).toBe('4560');
      expect(findField(derive([f('loanAmount', '10000'), f('totalRepayable', '12,500'), f('totalPaid', '7440')]), ['balance'])?.value).toBe('5060');
    });
    it('falls back to the loan amount when instalment × days is below it', () => {
      const card = [f('loanAmount', '₹10,000'), f('dailyInstalment', '₹50'), f('totalPaid', '₹6,200'), f('daysPaid', '62 / 100')];
      expect(findField(derive(card), ['balance'])?.value).toBe('3800');
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

    it('passes an interest-bearing card and warns against the amount repayable', () => {
      const card = [f('loanAmount', '₹10,000'), f('dailyInstalment', '₹120'), f('totalPaid', '₹7,440'), f('daysPaid', '62 / 100')];
      expect(validate([...card, f('balance', '₹4,560')])).toEqual([]);
      expect(validate([...card, f('balance', '₹2,560')])).toEqual([
        "Balance (₹2,560) doesn't equal amount repayable − total paid (₹12,000 − ₹7,440 = ₹4,560; repayable is ₹120 a day × 100 days). Please check the card.",
      ]);
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

  describe('total days written only in the scheme', () => {
    const card = [f('loanAmount', '₹10,000'), f('dailyInstalment', '₹120'), f('totalPaid', '₹7,440'), f('daysPaid', '62')];
    it('reads the tenure from the scheme', () => {
      for (const scheme of ['Daily loan (100 days)', '100 din', '100 दिन', '100-day loan']) {
        expect(validate([...card, f('scheme', scheme), f('balance', '₹4,560')])).toEqual([]);
        expect(findField(derive([...card, f('scheme', scheme)]), ['balance'])?.value).toBe('4560');
      }
      expect(validate([f('scheme', 'Daily loan (100 days)'), f('daysPaid', '102')])[0]).toMatch(/Days paid \(102\) is more than the total days \(100\)/);
    });
    it('does not work out a balance from the loan when the instalment has no known tenure', () => {
      expect(derive(card)).toBe(card);
      expect(validate([...card, f('balance', '₹4,560')])).toEqual([
        "Can't tell the total repayable, so the balance (₹4,560) can't be checked: the card has a daily instalment but no total days. Add Total Days (e.g. 100) if the loan carries interest.",
      ]);
      expect(validate([...card, f('balance', '₹2,560')])).toEqual([]);
    });
  });
});
