import { findField, type RecordField } from '@/modules/profiles';
import { decoratorChallan as profile } from '@/modules/profiles/decorator-challan';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/decorator-challan', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds total pieces from the item list and balance from rent − advance', () => {
      const out = derive([f('items', 'Chairs – 200; Tables – 20\nShamiana 40×60 – 1;'), f('rent', '₹18,500'), f('advance', 'Rs 8,000/-')]);
      expect(findField(out, ['totalPieces'])?.value).toBe('221');
      expect(findField(out, ['balance'])?.value).toBe('₹10,500');
      expect(out).toHaveLength(5);
    });

    it('counts the quantity after the item name, not a rate or amount later on the line', () => {
      const out = derive([f('items', 'Chairs – 200 × ₹10 = ₹2,000; Tables – 20 × ₹50 = ₹1,000; Shamiana 40×60 – 1')]);
      expect(findField(out, ['totalPieces'])?.value).toBe('221');
      expect(findField(out, ['totalReturned'])).toBeUndefined();
    });

    it('adds total returned when every line says how many came back', () => {
      const out = derive([f('items', 'Chairs – 200 – 195; Tables – 20 – 20')]);
      expect(findField(out, ['totalPieces'])?.value).toBe('220');
      expect(findField(out, ['totalReturned'])?.value).toBe('215');
      expect(findField(derive([f('items', 'Chairs – 200 – 195; Tables – 20')]), ['totalReturned'])).toBeUndefined();
    });

    it('skips a line without a separator that has rate maths, rather than guess', () => {
      const fields = [f('items', 'Chairs 200 x 10 = 2000')];
      expect(derive(fields)).toBe(fields);
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
      expect(validate([f('items', 'Chairs – 200 – 200; Tables – 20 – 20'), f('totalReturned', '210')])[0]).toMatch(/Total returned \(210\).*220/);
    });

    it('does not count rates and amounts as pieces', () => {
      expect(validate([f('items', 'Chairs – 200 × ₹10 = ₹2,000; Tables – 20 × ₹50 = ₹1,000'), f('totalPieces', '220')])).toEqual([]);
    });

    it('warns about items not returned when nothing is noted as short or damaged', () => {
      const items = f('items', 'Plastic chairs – 200 – 195; Round tables – 20 – 18; Shamiana – 1 – 1');
      const expected = 'Not returned: 5 Plastic chairs, 2 Round tables, but nothing is noted as short or damaged. Please recount, or note them under Short/Damaged.';
      expect(validate([items])).toEqual([expected]);
      expect(validate([items, f('itemsShortDamaged', 'Nil', 'Items Short/Damaged')])).toEqual([expected]);
      expect(validate([items, f('itemsShortDamaged', '5 chairs broken, 2 tables short', 'Items Short/Damaged')])).toEqual([]);
    });

    it('compares written totals when the item list has no returned quantities', () => {
      expect(validate([f('totalPieces', '239'), f('totalReturned', '230'), f('shortDamaged', '-')])[0]).toMatch(/^Not returned: 9 of 239 pieces/);
      expect(validate([f('totalPieces', '239'), f('totalReturned', '239')])).toEqual([]);
    });

    it('warns on a malformed phone number', () => {
      expect(validate([f('phone', '12345 678')])[0]).toMatch(/Phone "12345678"/);
    });
  });
});
