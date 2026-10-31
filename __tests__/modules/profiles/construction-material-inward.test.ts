import type { RecordField } from '@/modules/profiles';
import { constructionMaterialInward as profile } from '@/modules/profiles/construction-material-inward';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);

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
});
