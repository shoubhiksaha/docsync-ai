import type { RecordField } from '@/modules/profiles';
import { brickKilnToken as profile } from '@/modules/profiles/brick-kiln-token';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/brick-kiln-token', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds the amount from count / 1000 × rate', () => {
      const out = derive([f('brickCount', '4,500'), f('ratePerThousand', '₹650 per 1000')]);
      expect(out.find(x => x.key === 'amount')?.value).toBe('₹2,925');
    });
    it('expands counts written in thousands', () => {
      const amount = (count: string) => derive([f('brickCount', count), f('rate', '₹180')]).find(x => x.key === 'amount')?.value;
      expect(amount('3 हज़ार')).toBe('₹540');
      expect(amount('3.5K')).toBe('₹630');
      expect(amount('3,000')).toBe('₹540');
      expect(amount('4 thousand')).toBe('₹720');
    });
    it('keeps a written amount', () => {
      const fields = [f('brickCount', '3000'), f('rate', '180'), f('wages', '₹500', 'Wages')];
      expect(derive(fields)).toBe(fields);
    });
    it('leaves fields alone when count or rate is missing', () => {
      const fields = [f('brickCount', 'teen hazaar'), f('rate', '180')];
      expect(derive(fields)).toBe(fields);
      const noRate = [f('brickCount', '3000')];
      expect(derive(noRate)).toBe(noRate);
    });
  });

  describe('validate', () => {
    it('passes a consistent moulding token', () => {
      expect(validate([f('stage', 'Moulding (पथाई)'), f('brickCount', '4,500'), f('ratePerThousand', '650'), f('amount', '2,925')])).toEqual([]);
    });
    it('passes a dispatch token with a valid vehicle', () => {
      expect(validate([f('stage', 'निकासी'), f('brickCount', '3000'), f('vehicleNumber', 'up-32-ht-4417')])).toEqual([]);
    });
    it('warns when the amount does not match count × rate', () => {
      const w = validate([f('brickCount', '3,000'), f('rate', '₹180'), f('amount', '₹600')]);
      expect(w).toEqual([expect.stringContaining('3,000 bricks at ₹180 per 1,000 (= ₹540)')]);
    });
    it('checks counts written in thousands against the full count', () => {
      expect(validate([f('brickCount', '3 हज़ार'), f('rate', '₹180'), f('amount', '₹540')])).toEqual([]);
      expect(validate([f('brickCount', '3.5 thousand'), f('rate', '₹180'), f('amount', '₹630')])).toEqual([]);
      expect(validate([f('brickCount', '3.5K'), f('rate', '₹180'), f('amount', '₹600')])).toEqual([
        expect.stringContaining('3,500 bricks at ₹180 per 1,000 (= ₹630)'),
      ]);
    });
    it('warns on zero, negative or fractional counts', () => {
      expect(validate([f('brickCount', '0')])[0]).toMatch(/whole number above zero/);
      expect(validate([f('brickCount', '-200')])[0]).toMatch(/whole number above zero/);
      expect(validate([f('brickCount', '3.5')])[0]).toMatch(/whole number above zero/);
    });
    it('warns on an implausibly large count', () => {
      expect(validate([f('brickCount', '3,00,000')])[0]).toMatch(/3,00,000.*unusually high/);
    });
    it('warns on a malformed vehicle number', () => {
      expect(validate([f('vehicleNumber', 'Tractor wala')])[0]).toMatch(/"Tractor wala" doesn't look like/);
    });
    it('accepts a BH-series plate', () => {
      expect(validate([f('vehicleNumber', '22 BH 1234 AA')])).toEqual([]);
    });
    it('warns when a dispatch token has no vehicle', () => {
      expect(validate([f('stage', 'Dispatch (Loading)')])[0]).toMatch(/no vehicle number/);
    });
    it('reads a rate per brick or per hundred instead of assuming per 1,000', () => {
      const amount = (rate: string, label = 'Rate') => derive([f('brickCount', '5,000'), f('rate', rate, label)]).find(x => x.key === 'amount')?.value;
      expect(amount('₹7.50 per brick')).toBe('₹37,500');
      expect(amount('₹7.50 प्रति ईंट')).toBe('₹37,500');
      expect(amount('₹750 प्रति सैकड़ा')).toBe('₹37,500');
      expect(amount('₹7,500', 'Rate per 1,000')).toBe('₹37,500');
      expect(amount('₹7,500')).toBe('₹37,500');
      // Not a count of bricks: no amount is worked out.
      expect(amount('₹2,500 per trolley')).toBeUndefined();
      expect(validate([f('brickCount', '5,000'), f('rate', '₹7.50 per brick'), f('amount', '₹37,500')])).toEqual([]);
      expect(validate([f('brickCount', '5,000'), f('rate', '₹750 प्रति सैकड़ा'), f('amount', '₹37,500')])).toEqual([]);
      expect(validate([f('brickCount', '5,000'), f('rate', '₹7.50 per brick'), f('amount', '₹3,750')])).toEqual([
        expect.stringContaining('5,000 bricks at ₹7.5 a brick (= ₹37,500)'),
      ]);
      expect(validate([f('brickCount', '5,000'), f('rate', '₹750 per 100'), f('amount', '₹3,750')])).toEqual([
        expect.stringContaining('5,000 bricks at ₹750 per 100 (= ₹37,500)'),
      ]);
    });
    it('skips checks when values are missing', () => {
      expect(validate([f('stage', 'Firing')])).toEqual([]);
      expect(validate([])).toEqual([]);
    });
  });
});
