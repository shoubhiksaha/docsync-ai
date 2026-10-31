import { garageRepairEstimate } from '@/modules/profiles/garage-repair-estimate';
import type { RecordField } from '@/modules/profiles';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => garageRepairEstimate.derive!(fields);
const validate = (fields: RecordField[]) => garageRepairEstimate.validate!(fields);

describe('profiles/garage-repair-estimate', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(garageRepairEstimate)).toEqual([]);
    expect(garageRepairEstimate.duplicateKey).toBe('estimateNumber');
  });

  describe('derive', () => {
    it('adds the grand total from parts + labour + GST', () => {
      const out = derive([f('partsTotal', '₹3,900'), f('labourTotal', '1,200'), f('gst', '918')]);
      expect(out.find(x => x.key === 'grandTotal')?.value).toBe('6018');
      expect(out).toHaveLength(4);
    });
    it('treats missing GST as zero', () => {
      const out = derive([f('Parts Amount', '500', 'Parts Amount'), f('labour', '300')]);
      expect(out.find(x => x.key === 'grandTotal')?.value).toBe('800');
    });
    it('keeps a written grand total', () => {
      const fields = [f('partsTotal', '500'), f('labour', '300'), f('total', '900')];
      expect(derive(fields)).toBe(fields);
    });
    it('returns the fields unchanged when parts or labour are missing or unreadable', () => {
      const missing = [f('partsTotal', '500')];
      expect(derive(missing)).toBe(missing);
      const unreadable = [f('partsTotal', 'see list'), f('labour', '300')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes a consistent estimate', () => {
      expect(validate([
        f('partsTotal', '3900'), f('labourTotal', '1200'), f('gst', '918'), f('grandTotal', '6,020'),
        f('vehicleNumber', 'up-32-kx-4471'), f('gstin', '09aakfs 4471m1z3'), f('phone', '98765 43318'),
      ])).toEqual([]);
    });
    it('warns when the grand total does not add up', () => {
      const [w] = validate([f('partsTotal', '3900'), f('labourTotal', '1200'), f('gst', '918'), f('grandTotal', '6500')]);
      expect(w).toMatch(/Grand total \(₹6,500\).*= ₹6,018/);
    });
    it('checks the total without GST when none is charged', () => {
      expect(validate([f('partsTotal', '1000'), f('labour', '500'), f('total', '1500')])).toEqual([]);
      expect(validate([f('partsTotal', '1000'), f('labour', '500'), f('total', '1700')])[0]).toMatch(/GST ₹0/);
    });
    it('skips the total check when a figure is missing', () => {
      expect(validate([f('partsTotal', '1000'), f('total', '1')])).toEqual([]);
    });
    it('accepts standard, Delhi-style and BH-series number plates', () => {
      for (const plate of ['MH 12 AB 1234', 'DL 3C AB 1234', 'KA.05.MN.0987', '22 BH 1234 AA']) {
        expect(validate([f('vehicleNumber', plate)])).toEqual([]);
      }
    });
    it('warns on a malformed vehicle number', () => {
      expect(validate([f('vehicleNo', 'Swift 1234')])[0]).toMatch(/Vehicle number "Swift 1234"/);
    });
    it('warns on a malformed GSTIN', () => {
      expect(validate([f('gstNo', '09ABCDE1234')])[0]).toMatch(/GSTIN "09ABCDE1234"/);
    });
    it('warns on a malformed phone number', () => {
      expect(validate([f('mobile', '5555 12345')])[0]).toMatch(/Phone "5555 12345"/);
    });
    it('returns no warnings for an empty estimate', () => {
      expect(validate([])).toEqual([]);
    });
  });
});
