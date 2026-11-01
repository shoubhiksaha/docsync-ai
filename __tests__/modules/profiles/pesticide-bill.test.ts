import { findField, type RecordField } from '@/modules/profiles';
import { pesticideBill as profile } from '@/modules/profiles/pesticide-bill';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));
const bill = (items: string, date = '12-10-2026') => [f('date', date), f('items', items)];

describe('profiles/pesticide-bill', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds the total from subtotal + GST', () => {
      const out = derive([f('subtotal', '₹6,340.00'), f('gst', '₹709.20')]);
      expect(findField(out, ['total'])?.value).toBe('7049.2');
      expect(out).toHaveLength(3);
    });

    it('keeps a written total and skips unreadable inputs', () => {
      const stated = [f('subtotal', '100'), f('gst', '18'), f('total', '118')];
      expect(derive(stated)).toBe(stated);
      const unreadable = [f('subtotal', '100'), f('gst', 'nil')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes the mock bill', () => {
      expect(validate(profile.mockFields)).toEqual([]);
    });

    it('warns when subtotal + GST differs from the total', () => {
      expect(validate([f('subtotal', '6,340'), f('gst', '709.20'), f('total', '7,500')])).toEqual([
        expect.stringMatching(/Total \(₹7,500\) doesn't equal subtotal \+ GST .*₹7,049.2/),
      ]);
      expect(validate([f('subtotal', '6,340'), f('gst', '709.20'), f('total', '7,050')])).toEqual([]);
    });

    it('checks the GSTIN format, ignoring spaces and case', () => {
      expect(validate([f('dealerGstin', '23aksp k4521m1z8')])).toEqual([]);
      expect(validate([f('gstin', '23AKSPK4521M1X8')])[0]).toMatch(/GSTIN "23AKSPK4521M1X8" doesn't match/);
    });

    it('warns about items that expired before the bill date', () => {
      const warnings = validate(bill('Mancozeb 75% WP 1 kg – Batch MZ0925 – Exp 09/2026 – 1 × ₹520 = ₹520; Urea 45 kg – Batch U1 – Exp 2027-01-31'));
      expect(warnings).toEqual([expect.stringMatching(/before the bill date \(12-10-2026\) for: Mancozeb 75% WP 1 kg \(exp 09\/2026\)\./)]);
    });

    it('reads common expiry and bill date spellings', () => {
      const expired = (items: string, date?: string) => validate(bill(items, date)).some(w => /Expiry is before/.test(w));
      expect(expired('Imida, B.No. IM55, Exp. Dt. 11-10-2026')).toBe(true);
      expect(expired('Imida, B.No. IM55, Exp. Dt. 12-10-2026')).toBe(false);
      expect(expired('Imida - Batch IM55 - Expiry Date: Sep 2026', '12 Oct 2026')).toBe(true);
      expect(expired('Imida - Batch IM55 - Expiry: Oct-26', '2026-10-30')).toBe(false);
      expect(expired('Imida - Batch IM55 - Exp 08/28 - 10 x 520', '12/10/26')).toBe(false);
      expect(expired('Imida - Batch IM55 - Exp 09/25 - 10 x 520', '12/10/26')).toBe(true);
      expect(expired('Imida – Batch IM55 – एक्सपायरी 01/2026')).toBe(true);
    });

    it('reads a short month-only expiry as month/year, not as a day', () => {
      expect(validate(bill('Imida – Batch IM55 – Exp 03/12 - 10 × ₹10'))).toEqual([
        expect.stringMatching(/for: Imida \(exp 03\/2012\)\./),
      ]);
      expect(validate(bill('Imida – Batch IM55 – Exp 31-10-2025'))[0]).toMatch(/\(exp 31-10-2025\)/);
      expect(validate(bill('Imida – Batch IM55 – Exp 03/2028', '08-10-2026 11:42'))).toEqual([]);
    });
    it('ignores unreadable expiry or bill dates', () => {
      expect(validate(bill('Imida – Batch IM55 – Exp soon'))).toEqual([]);
      expect(validate(bill('Imida – Batch IM55 – Exp 13/2020'))).toEqual([]);
      expect(validate(bill('Imida – Batch IM55 – Exp Xyz 2020'))).toEqual([]);
      expect(validate(bill('Imida – Batch IM55 – Exp 01/2020', 'yesterday'))).toEqual([]);
      expect(validate(bill('Imida – Batch IM55', '99-99-2026'))).toEqual([]);
    });

    it('warns when items have no batch number', () => {
      const warnings = validate(bill('DAP 50 kg – 2 × ₹1,350 = ₹2,700; Mancozeb 1 kg – Batch NA – Exp 05/2028\nGram Seed 30 kg – Lot GS2609; Imida, B.No. IM55; Sulphur – Batch No: - '));
      expect(warnings).toEqual([expect.stringMatching(/No batch number recorded for: DAP 50 kg, Mancozeb 1 kg, Sulphur\. Dealers normally/)]);
    });

    it('does not mistake words containing "lot" for a lot number', () => {
      expect(validate(bill('Plot spray 1 L'))[0]).toMatch(/No batch number recorded for: Plot spray 1 L/);
    });

    it('stays quiet when nothing is readable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('subtotal', 'x'), f('gst', '18'), f('total', '118')])).toEqual([]);
    });
  });

  it('checks and derives the total from split CGST + SGST or a GST rate', () => {
    const sub = f('subtotal', '₹6,340');
    expect(validate([sub, f('cgst', '₹354.60'), f('sgst', '₹354.60'), f('total', '₹7,049.20')])).toEqual([]);
    expect(validate([sub, f('cgst', '₹354.60'), f('sgst', '₹354.60'), f('total', '₹6,340')])[0]).toMatch(/subtotal \+ GST \(₹6,340 \+ ₹709.2 = ₹7,049.2\)/);
    expect(validate([f('subtotal', '1000'), f('gst', '18%'), f('total', '1180')])).toEqual([]);
    expect(findField(derive([sub, f('cgst', '354.60'), f('sgst', '354.60')]), ['total'])?.value).toBe('7049.2');
  });
});
