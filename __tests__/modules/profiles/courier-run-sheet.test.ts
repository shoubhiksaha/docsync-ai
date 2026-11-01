import { findField, type RecordField } from '@/modules/profiles';
import { courierRunSheet } from '@/modules/profiles/courier-run-sheet';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => courierRunSheet.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(courierRunSheet.validate!(fields));

describe('profiles/courier-run-sheet', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(courierRunSheet)).toEqual([]);
  });

  describe('derive()', () => {
    it('derives the undelivered count from total and delivered', () => {
      const out = derive([f('totalShipments', '18'), f('delivered', '15')]);
      expect(findField(out, ['undelivered'])?.value).toBe('3');
      expect(out).toHaveLength(3);
    });
    it('derives the total from delivered and undelivered', () => {
      const out = derive([f('delivered', '15'), f('returned', '2')]);
      expect(findField(out, ['totalShipments'])?.value).toBe('17');
    });
    it('leaves the fields alone when nothing can or should be computed', () => {
      const complete = [f('totalShipments', '10'), f('delivered', '8'), f('undelivered', '2')];
      expect(derive(complete)).toBe(complete);
      const noDelivered = [f('totalShipments', '10'), f('delivered', 'all')];
      expect(derive(noDelivered)).toBe(noDelivered);
      const tooMany = [f('totalShipments', '10'), f('delivered', '12')];
      expect(derive(tooMany)).toBe(tooMany);
      const unreadableUndelivered = [f('totalShipments', '10'), f('delivered', '8'), f('undelivered', '?')];
      expect(derive(unreadableUndelivered)).toBe(unreadableUndelivered);
      const unreadableTotal = [f('totalShipments', 'n/a'), f('delivered', '8'), f('undelivered', '2')];
      expect(derive(unreadableTotal)).toBe(unreadableTotal);
      const deliveredOnly = [f('delivered', '8')];
      expect(derive(deliveredOnly)).toBe(deliveredOnly);
    });
  });

  describe('validate()', () => {
    it('flags counts that do not add up', () => {
      expect(validate([f('totalShipments', '18'), f('delivered', '15'), f('undelivered', '2')])[0])
        .toBe('Delivered (15) + undelivered (2) = 17, but total shipments is 18. Please check the counts.');
    });
    it('flags more deliveries than shipments when the undelivered count is missing', () => {
      expect(validate([f('totalShipments', '10'), f('delivered', '12')])[0]).toMatch(/Delivered \(12\) is more than total shipments \(10\)/);
      expect(validate([f('totalShipments', '10'), f('delivered', '7')])).toEqual([]);
    });
    it('warns on a COD shortfall and names the gap', () => {
      const [warning] = validate([f('codExpected', '₹6,450'), f('codCollected', '₹5,200')]);
      expect(warning).toMatch(/COD collected \(₹5,200\) is ₹1,250 short of COD expected \(₹6,450\)/);
    });
    it('warns when more COD was collected than expected', () => {
      expect(validate([f('codExpected', '3,640'), f('cashCollected', '3,700')])[0]).toMatch(/₹60 more than COD expected/);
    });
    it('allows a rupee of rounding on COD', () => {
      expect(validate([f('codExpected', '3640'), f('codCollected', '3639.50')])).toEqual([]);
      expect(validate([f('codExpected', '3640'), f('codCollected', '3641')])).toEqual([]);
    });
    it('returns nothing for missing or unreadable values', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('totalShipments', '10'), f('codExpected', 'nil'), f('codCollected', '0')])).toEqual([]);
    });
  });
});
