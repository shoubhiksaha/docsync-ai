import { tailoringMeasurement } from '@/modules/profiles/tailoring-measurement';
import type { RecordField } from '@/modules/profiles';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => tailoringMeasurement.derive!(fields);
const validate = (fields: RecordField[]) => tailoringMeasurement.validate!(fields);

describe('profiles/tailoring-measurement', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(tailoringMeasurement)).toEqual([]);
    expect(tailoringMeasurement.duplicateKey).toBe('orderNumber');
  });

  it('derives the mock balance from total − advance when the slip leaves it out', () => {
    const out = derive(tailoringMeasurement.mockFields.filter(m => m.key !== 'balance'));
    expect(out.find(x => x.key === 'balance')?.value).toBe('950');
  });

  it('gives the mock each common measurement as its own field, as on the sample, so their checks run', () => {
    const keys = tailoringMeasurement.mockFields.map(m => m.key);
    expect(keys).toEqual(expect.arrayContaining(['chest', 'waist', 'hip', 'shoulder', 'sleeve', 'length', 'neck', 'trialDate', 'balance']));
    const hip = tailoringMeasurement.mockFields.map(m => (m.key === 'hip' ? { ...m, value: '96' } : m));
    expect(validate(hip)).toEqual([expect.stringMatching(/^Hip 96 is outside/)]);
  });

  describe('derive', () => {
    it('keeps a written balance', () => {
      const fields = [f('totalAmount', '1450'), f('advance', '500'), f('baki', '950')];
      expect(derive(fields)).toBe(fields);
    });
    it('returns the fields unchanged when total or advance is missing or unreadable', () => {
      const missing = [f('totalAmount', '1450')];
      expect(derive(missing)).toBe(missing);
      const unreadable = [f('totalAmount', 'baad mein'), f('advance', '500')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes a consistent order', () => {
      expect(validate([
        f('chest', '36"'), f('kamar', '30'), f('hip', '38'), f('shoulder', '14.5'), f('sleeve', '4'), f('length', '70'), f('neck', '7'),
        f('totalAmount', '1450'), f('advance', '500'), f('balance', '950'),
        f('date', '20-10-2026'), f('trialDate', '29 Oct 2026'), f('deliveryDate', '2026-11-02'), f('phone', '98765 41890'),
      ])).toEqual([]);
    });
    it('warns on implausible measurements, naming each one', () => {
      const warnings = validate([f('chest', '91 cm'), f('neck', '2'), f('waist', 'loose')]);
      expect(warnings).toEqual([
        expect.stringMatching(/^Chest 91 is outside the usual 4–70 inches/),
        expect.stringMatching(/^Neck 2 is outside/),
      ]);
    });
    it('warns when the advance is more than the total', () => {
      expect(validate([f('total', '800'), f('advance', '1000'), f('balance', '-200')])).toEqual([
        expect.stringMatching(/Advance \(₹1,000\) is more than the total \(₹800\)/),
      ]);
    });
    it('warns when the balance does not equal total − advance', () => {
      expect(validate([f('total', '1450'), f('advance', '500'), f('balance', '850')])[0]).toMatch(/Balance \(₹850\).*= ₹950/);
    });
    it('skips the balance check when it is not written', () => {
      expect(validate([f('total', '1450'), f('advance', '500')])).toEqual([]);
      expect(validate([f('total', '1450'), f('balance', '1')])).toEqual([]);
    });
    it('warns when delivery is before the order date', () => {
      expect(validate([f('date', '20/10/26'), f('deliveryDate', '18/10/26')])[0]).toMatch(/Delivery date \(18\/10\/26\) is before the order date \(20\/10\/26\)/);
    });
    it('warns when the trial is after delivery', () => {
      expect(validate([f('trialDate', '05-Nov-2026'), f('deliveryDate', '02-11-2026')])[0]).toMatch(/Trial date \(05-Nov-2026\) is after the delivery date/);
    });
    it('ignores unreadable or impossible dates', () => {
      expect(validate([f('date', '30-02-2026'), f('trialDate', 'Diwali se pehle'), f('deliveryDate', '01-01-2026')])).toEqual([]);
      expect(validate([f('date', '01-Abc-2026'), f('deliveryDate', '01-01-2026')])).toEqual([]);
    });
    it('warns on a malformed phone number', () => {
      expect(validate([f('mobile', '1234567890')])[0]).toMatch(/Phone "1234567890"/);
    });
    it('returns no warnings for an empty page', () => {
      expect(validate([])).toEqual([]);
    });
  });
});
