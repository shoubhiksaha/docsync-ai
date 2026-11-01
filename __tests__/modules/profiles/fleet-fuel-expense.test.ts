import { findField, type RecordField } from '@/modules/profiles';
import { fleetFuelExpense } from '@/modules/profiles/fleet-fuel-expense';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => fleetFuelExpense.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(fleetFuelExpense.validate!(fields));

describe('profiles/fleet-fuel-expense', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(fleetFuelExpense)).toEqual([]);
  });

  describe('derive()', () => {
    it('derives litres for a preset-amount sale', () => {
      const out = derive([f('rate', '₹93.50'), f('amount', '₹2,000')]);
      expect(findField(out, ['quantity'])?.value).toBe('21.39');
      expect(out).toHaveLength(3);
    });
    it('derives the rate from quantity and amount', () => {
      const out = derive([f('quantity', '40 L'), f('amount', '3,600')]);
      expect(findField(out, ['rate'])?.value).toBe('90');
    });
    it('derives the amount from quantity and rate', () => {
      const out = derive([f('litres', '10.5'), f('ratePerLitre', '92.4')]);
      expect(findField(out, ['amount'])?.value).toBe('970.2');
    });
    it('leaves complete, partial, zero or unreadable values alone', () => {
      const complete = [f('quantity', '45.20'), f('rate', '92.45'), f('amount', '4178.74')];
      expect(derive(complete)).toBe(complete);
      const tollOnly = [f('expenseType', 'Toll'), f('amount', '₹265')];
      expect(derive(tollOnly)).toBe(tollOnly);
      const zeroRate = [f('rate', '0'), f('amount', '500')];
      expect(derive(zeroRate)).toBe(zeroRate);
      const zeroQty = [f('quantity', '0'), f('amount', '500')];
      expect(derive(zeroQty)).toBe(zeroQty);
      const unreadable = [f('quantity', 'illegible'), f('rate', '92'), f('amount', '900')];
      expect(derive(unreadable)).toBe(unreadable);
      const noRate = [f('quantity', '10'), f('rate', '—'), f('amount', '900')];
      expect(derive(noRate)).toBe(noRate);
      const noAmount = [f('quantity', '10'), f('rate', '90'), f('amount', 'cash')];
      expect(derive(noAmount)).toBe(noAmount);
    });
  });

  describe('validate()', () => {
    it('accepts standard, hyphenated and BH-series vehicle numbers', () => {
      for (const v of ['MH 12 RT 4508', 'dl-1c-1234', 'ka.05.mn.0712', '22 BH 1234 AA', 'GJ05BX3391', 'UP 32 T 123']) {
        expect(validate([f('vehicleNumber', v)])).toEqual([]);
      }
    });
    it('flags a malformed vehicle number', () => {
      expect(validate([f('vehicleNumber', 'MH 12 1234 AB X')])[0]).toMatch(/doesn't look like an Indian registration/);
      expect(validate([f('vehicleNo', '22 BH 12 A')])[0]).toMatch(/"22 BH 12 A"/);
      expect(validate([f('vehicleNo', 'GJ-05')])[0]).toMatch(/"GJ-05"/);
    });
    it('flags quantity × rate that does not match the amount', () => {
      const [warning] = validate([f('quantity', '45.20'), f('rate', '92.45'), f('amount', '₹4,000')]);
      expect(warning).toMatch(/45.2 L × ₹92.45 = ₹4,178.74/);
      expect(warning).toMatch(/₹4,000/);
    });
    it('allows small rounding on the amount', () => {
      expect(validate([f('quantity', '21.39'), f('rate', '93.50'), f('amount', '2000')])).toEqual([]);
    });
    it('flags an unusual petrol or diesel rate', () => {
      expect(validate([f('fuelType', 'HSD'), f('rate', '9.25')])[0]).toMatch(/₹9.25 per litre is unusual for HSD/);
      expect(validate([f('fuelType', 'Petrol'), f('rate', '145')])[0]).toMatch(/usually ₹70–130/);
      expect(validate([f('fuelType', 'डीज़ल'), f('rate', '91')])).toEqual([]);
    });
    it('skips the rate range for CNG or an unknown fuel type', () => {
      expect(validate([f('fuelType', 'CNG'), f('rate', '45')])).toEqual([]);
      expect(validate([f('rate', '45')])).toEqual([]);
    });
    it('returns nothing for empty or unreadable input', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('quantity', 'n/a'), f('rate', 'n/a'), f('amount', 'n/a'), f('vehicleNumber', '  ')])).toEqual([]);
    });
  });
});
