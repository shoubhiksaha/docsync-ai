import { findField, type RecordField } from '@/modules/profiles';
import { decoratorChallan as profile } from '@/modules/profiles/decorator-challan';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);

describe('profiles/decorator-challan', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds total pieces from the item list and balance from rent − advance', () => {
      const out = derive([f('items', 'Chairs – 200; Tables – 20\nShamiana 40×60 – 1;'), f('rent', '₹18,500'), f('advance', 'Rs 8,000/-')]);
      expect(findField(out, ['totalPieces'])?.value).toBe('221');
      expect(findField(out, ['balance'])?.value).toBe('10500');
      expect(out).toHaveLength(5);
    });

    it('keeps stated totals and returns the same fields', () => {
      const fields = [f('items', 'Chairs – 200'), f('totalPieces', '199'), f('rent', '100'), f('advance', '50'), f('balance', '50')];
      expect(derive(fields)).toBe(fields);
    });

    it('leaves fields alone when inputs are missing or unreadable', () => {
      const lineWithoutQty = [f('items', 'Chairs – 200; Tent'), f('rent', '₹5,000')];
      expect(derive(lineWithoutQty)).toBe(lineWithoutQty);
      const emptyList = [f('items', ' ; '), f('rent', 'n/a'), f('advance', '100')];
      expect(derive(emptyList)).toBe(emptyList);
      expect(derive([])).toEqual([]);
    });
  });

  describe('validate', () => {
    it('passes a consistent challan', () => {
      expect(validate(profile.mockFields)).toEqual([]);
      expect(validate([f('deliveryDate', '2026-10-28'), f('returnDate', '28 Oct 26'), f('phone', '+91-98765-41203')])).toEqual([]);
    });

    it('warns when the return date is before the delivery date', () => {
      expect(validate([f('deliveryDate', '28-Oct-2026'), f('returnDate', '27/10/2026')])[0]).toMatch(/Return date \(27\/10\/2026\) is before the delivery date \(28-Oct-2026\)/);
    });

    it('ignores unreadable dates', () => {
      expect(validate([f('deliveryDate', 'Sunday'), f('returnDate', '01-01-2020')])).toEqual([]);
      expect(validate([f('deliveryDate', '28-13-2026'), f('returnDate', '01-01-2020')])).toEqual([]);
      expect(validate([f('deliveryDate', '28-Xyz-2026'), f('returnDate', '01-01-2020')])).toEqual([]);
      expect(validate([f('deliveryDate', '28-10-2026')])).toEqual([]);
    });

    it('warns when balance is not rent − advance', () => {
      expect(validate([f('rent', '18500'), f('advance', '8000'), f('balance', '9500')])[0]).toMatch(/Balance \(₹9,500\) doesn't equal rent − advance .*₹10,500/);
      expect(validate([f('rent', '18500'), f('advance', '8000'), f('balance', '10501')])).toEqual([]);
    });

    it('warns when total pieces disagree with the item list', () => {
      expect(validate([f('items', 'Chairs – 200; Tables – 20'), f('totalPieces', '230')])[0]).toMatch(/Total pieces \(230\).*220/);
    });

    it('warns on a malformed phone number', () => {
      expect(validate([f('phone', '12345 678')])[0]).toMatch(/Phone "12345678"/);
    });
  });
});
