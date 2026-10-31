import type { RecordField } from '@/modules/profiles';
import { musterRoll as profile } from '@/modules/profiles/muster-roll';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);
const value = (fields: RecordField[], key: string) => fields.find(x => x.key === key)?.value;

// 6 + 5½ + 4½ = 16 person-days; at ₹500 a day = ₹8,000.
const WORKERS = 'Ramesh – 6 – ₹3,000; Sita – 5½ – ₹2,750; Geeta – 4½ days – ₹2,250';

describe('profiles/muster-roll', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('adds person-days, total wages and net payable', () => {
      const out = derive([f('workers', WORKERS), f('dailyWage', '₹500'), f('advances', '₹1,000')]);
      expect(value(out, 'personDays')).toBe('16');
      expect(value(out, 'totalWages')).toBe('8000');
      expect(value(out, 'netPayable')).toBe('7000');
    });
    it('sums worker amounts when there is no uniform daily wage', () => {
      const out = derive([f('workers', 'Ramesh – 6 – ₹3,300\nSita – ½ – ₹250')]);
      expect(value(out, 'personDays')).toBe('6.5');
      expect(value(out, 'totalWages')).toBe('3550');
      expect(value(out, 'netPayable')).toBeUndefined();
    });
    it('does not guess total wages when a worker has no amount', () => {
      const out = derive([f('workers', 'Ramesh – 6; Sita – 5 – ₹2,500')]);
      expect(value(out, 'personDays')).toBe('11');
      expect(value(out, 'totalWages')).toBeUndefined();
    });
    it('keeps written values', () => {
      const fields = [f('workers', WORKERS), f('personDays', '16'), f('totalWages', '8000'), f('netPayable', '8000'), f('advances', '0')];
      expect(derive(fields)).toBe(fields);
    });
    it('leaves fields alone when nothing can be computed', () => {
      const none = [f('siteName', 'Rampur')];
      expect(derive(none)).toBe(none);
      const unreadable = [f('workers', 'see attached sheet')];
      expect(derive(unreadable)).toBe(unreadable);
      const empty = [f('workers', ' ; ')];
      expect(derive(empty)).toBe(empty);
    });
    it('masks Aadhaar numbers to the last 4 digits', () => {
      const out = derive([
        f('aadhaarNumber', '2345 6789 0123', 'Aadhaar Number'),
        f('idProof', '3456-7890-1234', 'आधार नंबर'),
        f('workers', 'Ramesh (Aadhaar 234567890123) – 6 – ₹3,000'),
        f('siteName', 'Plot 1234 5678 9012'),
      ]);
      expect(value(out, 'aadhaarNumber')).toBe('XXXX XXXX 0123');
      expect(value(out, 'idProof')).toBe('XXXX XXXX 1234');
      expect(value(out, 'workers')).toBe('Ramesh (Aadhaar XXXX XXXX 0123) – 6 – ₹3,000');
      expect(value(out, 'siteName')).toBe('Plot 1234 5678 9012');
      expect(out.map(x => x.key)).toEqual(['aadhaarNumber', 'idProof', 'workers', 'siteName', 'personDays', 'totalWages']);
    });
    it('leaves an already masked Aadhaar alone', () => {
      const fields = [f('aadhar', 'XXXX XXXX 0123')];
      expect(derive(fields)).toBe(fields);
    });
  });

  describe('validate', () => {
    const good = [
      f('periodFrom', '20-10-2026'), f('periodTo', '25-10-2026'), f('workerCount', '3'), f('personDays', '16'),
      f('dailyWage', '500'), f('totalWages', '₹8,000'), f('advances', '₹1,000'), f('netPayable', '₹7,000'), f('workers', WORKERS),
    ];

    it('passes a consistent page', () => {
      expect(validate(good)).toEqual([]);
    });
    it('warns when person-days × rate does not match total wages', () => {
      const w = validate([f('personDays', '16'), f('dailyWage', '500'), f('totalWages', '9000')]);
      expect(w).toEqual([expect.stringContaining('16 person-days × ₹500 (= ₹8,000)')]);
    });
    it('warns when total − advances is not the net payable', () => {
      const w = validate([f('totalWages', '8000'), f('advances', '1000'), f('netPayable', '8000')]);
      expect(w).toEqual([expect.stringContaining('total wages ₹8,000 − advances ₹1,000 (= ₹7,000)')]);
    });
    it('treats missing advances as zero', () => {
      expect(validate([f('totalWages', '8000'), f('netPayable', '8000')])).toEqual([]);
      expect(validate([f('totalWages', '8000'), f('netPayable', '7000')])[0]).toMatch(/advances ₹0/);
    });
    it('warns when the period is in the wrong order', () => {
      expect(validate([f('periodFrom', '25/10/26'), f('periodTo', '20/10/26')])[0]).toMatch(/ends before it starts/);
    });
    it('reads a period written in one field', () => {
      expect(validate([f('period', '25-10-2026 to 20-10-2026')])[0]).toMatch(/ends before it starts/);
      expect(validate([f('period', 'Week 43')])).toEqual([]);
    });
    it('ignores impossible dates', () => {
      expect(validate([f('periodFrom', '31-02-2026'), f('periodTo', '20-01-2026')])).toEqual([]);
      expect(validate([f('periodFrom', '01-13-2026'), f('periodTo', '20-01-2026')])).toEqual([]);
    });
    it('warns when the worker count differs from the workers listed', () => {
      expect(validate([f('workers', WORKERS), f('numberOfWorkers', '4')])[0]).toMatch(/\(4\) doesn't match the 3 workers/);
    });
    it('warns when person-days differ from the workers listed', () => {
      expect(validate([f('workers', WORKERS), f('personDays', '17')])[0]).toMatch(/\(17\) don't match the workers listed \(16\)/);
    });
    it('warns when total wages differ from the workers listed', () => {
      expect(validate([f('workers', WORKERS), f('totalWages', '9000')])[0]).toMatch(/don't match the workers listed \(₹8,000\)/);
    });
    it('skips the worker total when a worker has no amount', () => {
      expect(validate([f('workers', 'Ramesh – 6; Sita – 5 – ₹2,500'), f('totalWages', '9000')])).toEqual([]);
    });
    it('warns when a worker amount is not days × daily wage', () => {
      const w = validate([f('workers', 'Ramesh – 1 – ₹600; Sita – 5½ – ₹2,750'), f('dailyWage', '500')]);
      expect(w).toEqual(['Ramesh: 1 day × ₹500 = ₹500, but ₹600 is written.']);
    });
    it('warns when a worker has more days than the period', () => {
      const w = validate([f('workers', 'Ramesh – 7 – ₹3,500; Sita – 6'), f('periodFrom', '20-10-2026'), f('periodTo', '25-10-2026')]);
      expect(w).toEqual(['Ramesh (7 days) worked more days than the 6 days in the period. Please check the attendance.']);
    });
    it('skips worker checks for unreadable lines and missing values', () => {
      expect(validate([f('workers', 'Ramesh 6 days'), f('workerCount', '9'), f('personDays', '99')])).toEqual([]);
      expect(validate([])).toEqual([]);
    });
  });
});
