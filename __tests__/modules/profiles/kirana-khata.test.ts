import { kiranaKhata } from '@/modules/profiles/kirana-khata';
import type { RecordField } from '@/modules/profiles';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => kiranaKhata.derive!(fields);
const validate = (fields: RecordField[]) => kiranaKhata.validate!(fields);

describe('profiles/kirana-khata', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(kiranaKhata)).toEqual([]);
  });

  it('has no duplicate key (a khata page has no unique number)', () => {
    expect(kiranaKhata.duplicateKey).toBeUndefined();
  });

  describe('derive', () => {
    it('adds the balance from opening + credit − paid', () => {
      const out = derive([f('openingBalance', '₹350'), f('totalCredit', '₹1,540'), f('totalPaid', '1300')]);
      expect(out.find(x => x.key === 'balanceDue')?.value).toBe('590');
      expect(out).toHaveLength(4);
    });
    it('treats a missing opening balance as zero', () => {
      const out = derive([f('Total Udhaar', '900', 'Total Udhaar'), f('jama', '400')]);
      expect(out.find(x => x.key === 'balanceDue')?.value).toBe('500');
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
    it('returns no warnings for an empty page', () => {
      expect(validate([])).toEqual([]);
    });
  });
});
