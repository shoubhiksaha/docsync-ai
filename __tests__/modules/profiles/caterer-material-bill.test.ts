import { findField, type RecordField } from '@/modules/profiles';
import { catererMaterialBill as profile } from '@/modules/profiles/caterer-material-bill';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));
const ITEMS = 'Potato – 50 kg × ₹24 = ₹1,200; Onion – 40 kg × ₹32 = ₹1,280\nPaneer: 12 kg @ Rs 340';

describe('profiles/caterer-material-bill', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  it('has no default duplicate check (many mandi bills carry no number)', () => {
    expect(profile.duplicateKey).toBeUndefined();
  });

  describe('derive', () => {
    it('adds item count, total and balance when the bill does not state them', () => {
      const out = derive([f('items', ITEMS), f('paid', '₹5,000')]);
      expect(findField(out, ['itemCount'])?.value).toBe('3');
      expect(findField(out, ['total'])?.value).toBe('6560');
      expect(findField(out, ['balance'])?.value).toBe('1560');
    });

    it('uses a written total for the balance and keeps stated values', () => {
      const out = derive([f('total', '₹5,120'), f('paid', '3,000')]);
      expect(findField(out, ['balance'])?.value).toBe('2120');
      expect(out).toHaveLength(3);
      const stated = [f('items', ITEMS), f('itemCount', '3'), f('total', '6560'), f('paid', '0'), f('balance', '6560')];
      expect(derive(stated)).toBe(stated);
    });

    it('returns the fields unchanged when nothing can be computed', () => {
      const fields = [f('items', '  '), f('paid', '100')];
      expect(derive(fields)).toBe(fields);
    });

    it('does not total items it cannot read', () => {
      const out = derive([f('items', 'Potato 50 kg; Onion – 40 kg × 32')]);
      expect(findField(out, ['itemCount'])?.value).toBe('2');
      expect(findField(out, ['total'])).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('passes the mock bill', () => {
      expect(validate(profile.mockFields)).toEqual([]);
    });

    it('flags a line whose quantity × rate is not its amount', () => {
      expect(validate([f('items', 'Onion – 40 kg × ₹32 = ₹1,320; Garlic – 6 kg x 120 = 720')])).toEqual([
        'Onion: quantity × rate is ₹1,280, but ₹1,320 is written. Check this line.',
      ]);
    });

    it('warns when the total does not match the sum of the items', () => {
      expect(validate([f('items', ITEMS), f('total', '6,000')])).toEqual([
        expect.stringMatching(/Total \(₹6,000\) doesn't match the sum of the items \(₹6,560\)/),
      ]);
      expect(validate([f('items', ITEMS), f('total', '6,560')])).toEqual([]);
      expect(validate([f('items', 'Potato 50 kg'), f('total', '6,000')])).toEqual([]);
    });

    it('warns when paid is more than the total', () => {
      expect(validate([f('total', '5,120'), f('paid', '6,000'), f('balance', '0')])).toEqual([expect.stringMatching(/Paid \(₹6,000\) is more than/)]);
    });

    it('warns when balance is not total − paid', () => {
      expect(validate([f('total', '5,120'), f('paid', '3,000'), f('balance', '2,000')])).toEqual([
        expect.stringMatching(/Balance \(₹2,000\) doesn't equal total − paid .*₹2,120/),
      ]);
      expect(validate([f('total', '5,120'), f('paid', '3,000')])).toEqual([]);
    });

    it('checks the supplier mobile number', () => {
      expect(validate([f('supplierPhone', '+91 98765 41207')])).toEqual([]);
      expect(validate([f('phone', '12345 6789')])[0]).toMatch(/Phone "123456789" doesn't look like/);
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('total', 'NA'), f('paid', '100'), f('balance', '5')])).toEqual([]);
    });
  });
});
