import { kiranaKhata } from '@/modules/profiles/kirana-khata';
import type { RecordField } from '@/modules/profiles';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => kiranaKhata.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(kiranaKhata.validate!(fields));

describe('profiles/kirana-khata', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(kiranaKhata)).toEqual([]);
  });

  it('checks duplicates on customer and last entry date, so the same page scanned twice is caught', () => {
    expect(kiranaKhata.duplicateKey).toBe('slipId');
    const page = [f('customerName', 'Ramesh  Yadav'), f('toDate', '24/10/26'), f('balanceDue', '₹590')];
    expect(derive(page)).toEqual([...page, { key: 'slipId', label: 'Slip ID', value: 'Ramesh Yadav · 24-10-2026', confidence: 100, category: 'identity' }]);
    // The page grown by a new entry is a new record.
    expect(derive([...page.slice(0, 1), f('toDate', '28-10-2026'), page[2]]).at(-1)?.value).toBe('Ramesh Yadav · 28-10-2026');
  });

  describe('derive', () => {
    it('adds the balance from opening + credit − paid', () => {
      const out = derive([f('openingBalance', '₹350'), f('totalCredit', '₹1,540'), f('totalPaid', '1300')]);
      expect(out.find(x => x.key === 'balanceDue')?.value).toBe('₹590');
      expect(out).toHaveLength(4);
    });
    it('treats a missing opening balance as zero', () => {
      const out = derive([f('Total Udhaar', '900', 'Total Udhaar'), f('jama', '400')]);
      expect(out.find(x => x.key === 'balanceDue')?.value).toBe('₹500');
    });
    it('reads totals written in a Cr (credit) column as rupees, not crore', () => {
      const out = derive([f('totalCredit', '₹1,540 Cr'), f('totalPaid', '₹1,300 Dr')]);
      expect(out.find(x => x.key === 'balanceDue')?.value).toBe('₹240');
      expect(validate([f('totalCredit', '1.5 Cr'), f('totalPaid', '0'), f('balanceDue', '₹1.5')])).toEqual([]);
    });
    it('keeps a written balance', () => {
      const fields = [f('totalCredit', '100'), f('totalPaid', '50'), f('baki', '70')];
      expect(derive(fields)).toBe(fields);
    });
    it('returns the fields unchanged when totals are missing or unreadable', () => {
      const missing = [f('totalCredit', '100')];
      expect(derive(missing)).toBe(missing);
      const unreadable = [f('totalCredit', 'n/a'), f('totalPaid', '50')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes a consistent page', () => {
      expect(validate([
        f('phone', '+91 98765-41207'), f('openingBalance', '350'), f('totalCredit', '1540'),
        f('totalPaid', '1300'), f('balanceDue', '590.50'), f('fromDate', '1 Oct 2026'), f('toDate', '2026-10-24'),
      ])).toEqual([]);
    });
    it('warns when the balance does not add up', () => {
      const [w] = validate([f('openingBalance', '350'), f('totalCredit', '1540'), f('totalPaid', '1300'), f('balanceDue', '690')]);
      expect(w).toMatch(/Balance due \(₹690\).*₹590/);
    });
    it('uses zero opening balance when none is written', () => {
      expect(validate([f('totalCredit', '1000'), f('totalPaid', '400'), f('balance', '600')])).toEqual([]);
      expect(validate([f('totalCredit', '1000'), f('totalPaid', '400'), f('balance', '700')])[0]).toMatch(/opening ₹0/);
    });
    it('reads a balance the customer has paid ahead as negative', () => {
      const page = [f('openingBalance', '0'), f('totalCredit', '500'), f('totalPaid', '700')];
      expect(validate([...page, f('balanceDue', '-₹200')])).toEqual([]);
      expect(validate([...page, f('balanceDue', '₹200 advance')])).toEqual([]);
      expect(validate([...page, f('balanceDue', '200 Cr')])).toEqual([]);
      expect(validate([...page, f('balanceDue', '₹200')])[0]).toMatch(/Balance due \(₹200\).*= −₹200/);
    });
    it('skips the balance check when a total is missing', () => {
      expect(validate([f('totalCredit', '1000'), f('balance', '1')])).toEqual([]);
    });
    it('warns on a malformed phone number', () => {
      expect(validate([f('phone', '12345')])[0]).toMatch(/Phone "12345"/);
      expect(validate([f('mobile', '09876541207')])).toEqual([]);
    });
    it('warns when the date range is reversed', () => {
      expect(validate([f('fromDate', '24/10/26'), f('toDate', '01/10/26')])[0]).toMatch(/From date \(24\/10\/26\) is after/);
      expect(validate([f('fromDate', '24-Oct-2026'), f('lastEntryDate', '01-November-2026')])).toEqual([]);
    });
    it('ignores unreadable or impossible dates', () => {
      expect(validate([f('fromDate', '31-02-2026'), f('toDate', '01-01-2026')])).toEqual([]);
      expect(validate([f('fromDate', '05-Foo-2026'), f('toDate', '01-01-2026')])).toEqual([]);
      expect(validate([f('fromDate', 'Diwali'), f('toDate', '01-01-2026')])).toEqual([]);
    });
    it('checks the udhaar and jama entries add up to the totals', () => {
      const entries = (text: string) => f('entries', text);
      const ENTRIES = '01-10 – Atta 10 kg – udhaar ₹640; 05-10 – jama ₹500; 09-10 – Oil, Sugar – उधार 265; 14-10 – ₹480 udhaar; 20-10 – जमा 800; 24-10 – Soap – नामे ₹155';
      const totals = [f('totalCredit', '₹1,540'), f('totalPaid', '₹1,300')];
      expect(validate([entries(ENTRIES), ...totals])).toEqual([]);
      expect(validate([entries(ENTRIES), f('totalCredit', '₹1,450'), f('totalPaid', '₹1,200')])).toEqual([
        expect.stringMatching(/Total credit \(₹1,450\).*add up to ₹1,540/),
        expect.stringMatching(/Total paid \(₹1,200\).*add up to ₹1,300/),
      ]);
      // An opening balance written as an entry is not credit.
      expect(validate([entries(`पिछला बाकी ₹350; ${ENTRIES}`), ...totals])).toEqual([]);
    });
    it('skips the entry check when an entry has no amount marked udhaar or jama', () => {
      const totals = [f('totalCredit', '₹2,000'), f('totalPaid', '₹0')];
      expect(validate([f('entries', '01-10 – udhaar ₹640; 05-10 – Atta 10 kg ₹500'), ...totals])).toEqual([]);
      expect(validate([f('entries', '01-10 – udhaar; 05-10 – udhaar ₹500'), ...totals])).toEqual([]);
    });
    it('returns no warnings for an empty page', () => {
      expect(validate([])).toEqual([]);
    });
  });
});
