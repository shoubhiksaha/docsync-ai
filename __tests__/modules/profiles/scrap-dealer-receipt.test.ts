import type { RecordField } from '@/modules/profiles';
import { scrapDealerReceipt as profile } from '@/modules/profiles/scrap-dealer-receipt';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));
const value = (fields: RecordField[], key: string) => fields.find(x => x.key === key)?.value;

const ITEMS = 'Newspaper – 12 kg × ₹14 = ₹168; Iron – 6.5 kg × ₹28 = ₹182; Copper – 500 g × ₹560 = ₹280';

describe('profiles/scrap-dealer-receipt', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds total weight and amount from the items', () => {
      const out = derive([f('items', ITEMS)]);
      expect(value(out, 'totalWeight')).toBe('19 kg');
      expect(value(out, 'totalAmount')).toBe('₹630');
    });
    it('uses weight × rate for lines without an amount and pieces for counted items', () => {
      const out = derive([f('items', 'Battery – 2 pcs × ₹80\nTin 10 kg @ 20')]);
      expect(value(out, 'totalAmount')).toBe('₹360');
      expect(value(out, 'totalWeight')).toBeUndefined();
    });
    it('keeps written totals', () => {
      const fields = [f('items', ITEMS), f('totalWeight', '19 kg'), f('total', '₹630', 'Total')];
      expect(derive(fields)).toBe(fields);
    });
    it('adds only the missing total', () => {
      const out = derive([f('items', ITEMS), f('totalWeight', '19')]);
      expect(out.map(x => x.key)).toEqual(['items', 'totalWeight', 'totalAmount']);
    });
    it('leaves fields alone without items or for a rate card', () => {
      const none = [f('totalAmount', '500')];
      expect(derive(none)).toBe(none);
      const rateCard = [f('items', 'Newspaper – ₹14/kg; Iron – ₹28/kg')];
      expect(derive(rateCard)).toBe(rateCard);
      const empty = [f('items', ' ; ')];
      expect(derive(empty)).toBe(empty);
    });
  });

  describe('validate', () => {
    it('passes a consistent receipt', () => {
      expect(validate([f('items', ITEMS), f('totalWeight', '19 kg'), f('totalAmount', '₹630')])).toEqual([]);
    });
    it('passes a rate card and a receipt without items', () => {
      expect(validate([f('items', 'Newspaper – ₹14/kg; Cardboard – ₹9/kg')])).toEqual([]);
      expect(validate([f('totalAmount', '₹630')])).toEqual([]);
    });
    it('warns when an item amount is not weight × rate', () => {
      const w = validate([f('items', 'Iron – 6.5 kg × ₹28 = ₹200')]);
      expect(w).toEqual([expect.stringContaining('"Iron": 6.5 × ₹28 = ₹182, but ₹200 is written')]);
    });
    it('warns when the total amount does not match the items', () => {
      const w = validate([f('items', ITEMS), f('totalAmount', '₹1,630')]);
      expect(w).toEqual([expect.stringContaining('Total amount (₹1,630) doesn\'t match the items (₹630)')]);
    });
    it('warns when the total weight does not match the items', () => {
      const w = validate([f('items', ITEMS), f('totalWeight', '21 kg')]);
      expect(w).toEqual([expect.stringContaining('Total weight (21 kg) doesn\'t match the items (19 kg)')]);
    });
    it('skips totals when any line cannot be read', () => {
      const items = `${ITEMS}; Brass – some`;
      expect(validate([f('items', items), f('totalWeight', '50'), f('totalAmount', '9999')])).toEqual([]);
    });
    it('reads lines that start with the weight and amounts with commas', () => {
      expect(validate([f('items', '2 kg × ₹600 = ₹1,200'), f('totalAmount', '1200')])).toEqual([]);
      expect(validate([f('items', '– 2 kg × ₹600 = ₹1,300')])[0]).toMatch(/^"– 2 kg × ₹600 = ₹1300": 2 × ₹600 = ₹1,200/);
    });
    it('checks items counted in pieces against the per-piece rate', () => {
      expect(validate([f('items', 'Battery – 2 pcs × ₹80 = ₹160'), f('totalAmount', '160')])).toEqual([]);
      expect(validate([f('items', 'Battery – 2 pcs × ₹80 = ₹180')])[0]).toMatch(/"Battery": 2 × ₹80 = ₹160/);
    });
    it('reads the total weight in its unit', () => {
      expect(validate([f('items', 'Iron – 120 kg × ₹28 = ₹3,360'), f('totalWeight', '1.2 qtl')])).toEqual([]);
      expect(validate([f('items', 'Copper – 500 g × ₹560 = ₹280; Newspaper – 12 kg × ₹14 = ₹168'), f('totalWeight', '12 kg 500 g')])).toEqual([]);
      expect(validate([f('items', 'Iron – 120 kg × ₹28 = ₹3,360'), f('totalWeight', '1.5 qtl')])[0]).toMatch(/Total weight \(150 kg\) doesn't match the items \(120 kg\)/);
    });
    it('reads items weighed in quintals, tonnes or grams', () => {
      const items = 'Iron – 1.5 qtl × ₹2,800/qtl = ₹4,200; Tin – 2 क्विंटल × ₹1,500 = ₹3,000; Brass – 250 ग्राम × ₹400 = ₹100';
      expect(validate([f('items', items), f('totalWeight', '350.25 kg'), f('totalAmount', '₹7,300')])).toEqual([]);
      expect(value(derive([f('items', items)]), 'totalWeight')).toBe('350.25 kg');
      expect(validate([f('items', 'Iron – 0.5 MT × ₹28 = ₹14,000'), f('totalWeight', '500 kg')])).toEqual([]);
      expect(validate([f('items', 'Iron – 1.5 qtl × ₹28 = ₹4,000')])[0]).toMatch(/"Iron": 1.5 × ₹28 = ₹4,200, but ₹4,000/);
    });
  });
});
