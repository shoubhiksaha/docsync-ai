import type { RecordField } from '@/modules/profiles';
import { constructionMaterialInward as profile } from '@/modules/profiles/construction-material-inward';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/construction-material-inward', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds the amount from quantity × rate when the challan has none', () => {
      const out = derive([f('quantity', '200 bags'), f('rate', '₹382.50')]);
      expect(out.find(x => x.key === 'amount')?.value).toBe('76500');
    });
    it('keeps a written amount', () => {
      const fields = [f('quantity', '4'), f('rate', '5500'), f('totalAmount', '₹21,000', 'Total Amount')];
      expect(derive(fields)).toBe(fields);
    });
    it('leaves fields alone when quantity or rate is missing or unreadable', () => {
      const fields = [f('quantity', 'four'), f('rate', '5500')];
      expect(derive(fields)).toBe(fields);
      const noRate = [f('quantity', '4')];
      expect(derive(noRate)).toBe(noRate);
    });
  });

  describe('validate', () => {
    const good = [f('quantity', '4'), f('unit', 'Brass'), f('rate', '₹5,500'), f('amount', '₹22,000'), f('vehicleNumber', 'MH-14-GU-3382')];

    it('passes a consistent challan', () => {
      expect(validate(good)).toEqual([]);
    });
    it('allows small rounding differences', () => {
      expect(validate([f('quantity', '3.33 MT'), f('rate', '6000'), f('amount', '19,990')])).toEqual([]);
    });
    it('warns when quantity × rate does not match the amount', () => {
      const w = validate([f('quantity', '4'), f('unit', 'brass'), f('rate', '5500'), f('amount', '24000')]);
      expect(w).toEqual([expect.stringContaining('doesn\'t match quantity × rate (4 × ₹5,500 = ₹22,000)')]);
    });
    it('warns on a zero quantity', () => {
      expect(validate([f('quantity', '0'), f('unit', 'bags')])[0]).toMatch(/more than zero/);
    });
    it('warns when a bare quantity has no unit', () => {
      expect(validate([f('quantity', '200')])[0]).toMatch(/has no unit/);
    });
    it('accepts a unit written inside the quantity', () => {
      expect(validate([f('quantity', '200 bags')])).toEqual([]);
    });
    it('accepts standard, Delhi and BH-series plates', () => {
      for (const plate of ['UP 32 T 123', 'DL 3C AB 1234', '22 BH 1234 AA', 'gj.01.ab.0042']) {
        expect(validate([f('vehicleNumber', plate)])).toEqual([]);
      }
    });
    it('warns on a malformed vehicle number', () => {
      expect(validate([f('vehicleNumber', 'TRACTOR 7')])[0]).toMatch(/"TRACTOR 7" doesn't look like/);
    });
    it('skips checks when values are missing or unreadable', () => {
      expect(validate([f('rate', 'n/a'), f('amount', '')])).toEqual([]);
      expect(validate([])).toEqual([]);
    });
  });
  it('accepts a unit written in Hindi', () => {
    for (const quantity of ['50 बोरी', '2 ब्रास', '3 ट्रॉली', '12 नग']) {
      expect(validate([f('quantity', quantity)])).toEqual([]);
    }
    expect(validate([f('quantity', '50 बोरी'), f('rate', '₹380'), f('amount', '₹19,000')])).toEqual([]);
    expect(validate([f('quantity', '50')])[0]).toMatch(/has no unit/);
  });

  describe('a rate written with its basis', () => {
    const amount = (fields: RecordField[]) => derive(fields).find(x => x.key === 'amount')?.value;

    it('divides a rate per 1,000 (bricks) by 1,000', () => {
      expect(amount([f('quantity', '5000 nos'), f('rate', '₹7,500 per 1000')])).toBe('37500');
      expect(amount([f('quantity', '5000'), f('unit', 'Nos'), f('rate', '₹7,500/हज़ार')])).toBe('37500');
      expect(amount([f('quantity', '5000 नग'), f('rate', '₹750 प्रति सैकड़ा')])).toBe('37500');
      expect(amount([f('quantity', '5000 bricks'), f('rate', '₹7,500 per thousand')])).toBe('37500');
      expect(validate([f('quantity', '5000 nos'), f('rate', '₹7,500 per 1000'), f('amount', '₹37,500')])).toEqual([]);
      expect(validate([f('quantity', '5000 nos'), f('rate', '₹7,500 per 1000'), f('amount', '₹40,000')]))
        .toEqual([expect.stringContaining('(5000 × ₹7,500/1,000 = ₹37,500)')]);
    });
    it('converts a weight to the rate\'s unit (steel in MT at a rate per kg)', () => {
      expect(amount([f('quantity', '2.5 MT'), f('rate', '₹58/kg')])).toBe('145000');
      expect(amount([f('quantity', '2.5'), f('unit', 'MT'), f('rate', '58', 'Rate per kg')])).toBe('145000');
      expect(validate([f('quantity', '2.5 MT'), f('rate', '₹58/kg'), f('amount', '₹1,45,000')])).toEqual([]);
      expect(validate([f('quantity', '2.5 MT'), f('rate', '₹58/kg'), f('amount', '₹1,50,000')]))
        .toEqual([expect.stringContaining('(2500 kg × ₹58/kg = ₹1,45,000)')]);
    });
    it('keeps a rate per the quantity\'s own unit and ignores "/-"', () => {
      expect(amount([f('quantity', '50 bags'), f('rate', '₹380 per bag')])).toBe('19000');
      expect(amount([f('quantity', '4'), f('unit', 'Brass'), f('rate', '₹5,500/- per brass')])).toBe('22000');
      expect(amount([f('quantity', '4 brass'), f('ratePerUnit', '₹5,500', 'Rate per Unit')])).toBe('22000');
    });
    it('works nothing out when the unit does not match the basis', () => {
      const fields = [f('quantity', '50 bags'), f('rate', '₹58 per kg')];
      expect(derive(fields)).toBe(fields);
      expect(validate([...fields, f('amount', '₹19,000')])).toEqual([]);
      const trips = [f('quantity', '4 brass'), f('rate', '₹6,000 per trip')];
      expect(derive(trips)).toBe(trips);
    });
  });
});
