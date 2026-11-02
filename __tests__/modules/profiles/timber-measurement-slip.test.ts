import type { RecordField } from '@/modules/profiles';
import { timberMeasurementSlip as profile } from '@/modules/profiles/timber-measurement-slip';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));
const value = (fields: RecordField[], key: string) => fields.find(x => x.key === key)?.value;

// Hoppus: (48/4)² × 10 / 144 = 10 cft; (40/4)² × 12 / 144 = 8.33 cft.
const LOGS = '10 ft × 48 in; 12 ft × 40 in';

describe('profiles/timber-measurement-slip', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds total volume from the logs and the amount from volume × rate', () => {
      const out = derive([f('logs', LOGS), f('ratePerCft', '₹1,400')]);
      expect(value(out, 'totalVolume')).toBe('18.33');
      expect(value(out, 'amount')).toBe('₹25,662');
    });
    it('adds only the amount when the volume is written', () => {
      const out = derive([f('cft', '20 cft', 'CFT'), f('rate', '500')]);
      expect(out.map(x => x.key)).toEqual(['cft', 'rate', 'amount']);
      expect(value(out, 'amount')).toBe('₹10,000');
    });
    it('keeps written values', () => {
      const fields = [f('logs', LOGS), f('totalVolume', '18.33'), f('rate', '1400'), f('amount', '25,662')];
      expect(derive(fields)).toBe(fields);
    });
    it('leaves fields alone when nothing can be computed', () => {
      const none = [f('woodSpecies', 'Teak')];
      expect(derive(none)).toBe(none);
      const unreadable = [f('logs', 'ten logs, big'), f('rate', '1400')];
      expect(derive(unreadable)).toBe(unreadable);
      const metric = [f('logs', '3 m × 120 cm')];
      expect(derive(metric)).toBe(metric);
      const empty = [f('logs', ' ; ')];
      expect(derive(empty)).toBe(empty);
    });
  });

  describe('validate', () => {
    it('passes a consistent slip', () => {
      expect(validate([f('logs', LOGS), f('pieceCount', '2'), f('totalVolume', '18.33'), f('ratePerCft', '1400'), f('amount', '25,662')])).toEqual([]);
    });
    it('reads girth-first logs and inch/foot marks', () => {
      expect(validate([f('logs', '48 in × 10 ft\n40" × 12\''), f('totalVolume', '18.33')])).toEqual([]);
      expect(validate([f('logs', '10 x 48 inches; 12 × 40 इंच'), f('totalVolume', '18.33')])).toEqual([]);
    });
    it('warns when the amount is not volume × rate', () => {
      const w = validate([f('totalVolume', '18.33'), f('rate', '1400'), f('amount', '27,000')]);
      expect(w).toEqual([expect.stringContaining('18.33 cft × ₹1,400 (= ₹25,662)')]);
    });
    it('warns when the log count differs from the logs listed', () => {
      expect(validate([f('logs', LOGS), f('numberOfLogs', '3')])[0]).toMatch(/\(3\) doesn't match the 2 logs/);
    });
    it('warns when the total volume is far from the Hoppus total', () => {
      const w = validate([f('logs', LOGS), f('totalVolume', '23')]);
      expect(w).toEqual([expect.stringContaining('Hoppus total of the logs listed (18.33 cft')]);
    });
    it('tolerates small rounding in the volume', () => {
      expect(validate([f('logs', LOGS), f('totalVolume', '18.5')])).toEqual([]);
    });
    it('counts a line of equal logs as that many logs', () => {
      expect(validate([f('logs', '10 ft × 48 in × 3 nos'), f('pieceCount', '3'), f('totalVolume', '30')])).toEqual([]);
      expect(validate([f('logs', '3 nos × 10 ft × 48 in; 12 ft × 40 in'), f('pieceCount', '4'), f('totalVolume', '38.33')])).toEqual([]);
      expect(validate([f('logs', '3 × 10 ft × 48 in'), f('pieceCount', '3'), f('totalVolume', '30')])).toEqual([]);
      expect(validate([f('logs', '10 × 48 × 2; 12 × 40 × 1 नग'), f('pieceCount', '3'), f('totalVolume', '28.33')])).toEqual([]);
      expect(validate([f('logs', '10 ft × 48 in × 3 nos'), f('pieceCount', '2')])[0]).toMatch(/\(2\) doesn't match the 3 logs/);
      const out = derive([f('logs', '10 ft × 48 in × 3 pcs'), f('rate', '1000')]);
      expect(value(out, 'totalVolume')).toBe('30');
      expect(value(out, 'amount')).toBe('₹30,000');
    });
    it('skips the log checks for metric or unreadable logs', () => {
      expect(validate([f('logs', '3 mtr × 120 cm'), f('pieceCount', '4'), f('totalVolume', '99')])).toEqual([]);
      expect(validate([f('logs', 'see register'), f('pieceCount', '4')])).toEqual([]);
      expect(validate([])).toEqual([]);
    });
  });
});
