import { garageRepairEstimate } from '@/modules/profiles/garage-repair-estimate';
import { findField, type RecordField } from '@/modules/profiles';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => garageRepairEstimate.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(garageRepairEstimate.validate!(fields));

describe('profiles/garage-repair-estimate', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(garageRepairEstimate)).toEqual([]);
    expect(garageRepairEstimate.duplicateKey).toBe('estimateNumber');
  });

  describe('derive', () => {
    it('adds the grand total from parts + labour + GST', () => {
      const out = derive([f('partsTotal', '₹3,900'), f('labourTotal', '1,200'), f('gst', '918')]);
      expect(out.find(x => x.key === 'grandTotal')?.value).toBe('₹6,018');
      expect(out).toHaveLength(4);
    });
    it('treats missing GST as zero', () => {
      const out = derive([f('Parts Amount', '500', 'Parts Amount'), f('labour', '300')]);
      expect(out.find(x => x.key === 'grandTotal')?.value).toBe('₹800');
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

  describe('GST printed as CGST + SGST, as a rate, or with a discount', () => {
    const job = [f('partsTotal', '₹4,000'), f('labourTotal', '₹1,000')];
    it('adds up split CGST and SGST (or IGST)', () => {
      expect(validate([...job, f('cgst', '₹450'), f('sgst', '₹450'), f('grandTotal', '₹5,900')])).toEqual([]);
      expect(validate([...job, f('igst', '900', 'IGST'), f('grandTotal', '5900')])).toEqual([]);
      expect(findField(derive([...job, f('cgst', '450'), f('sgst', '450')]), ['grandTotal'])?.value).toBe('₹5,900');
    });
    it('works out a GST written as a percent', () => {
      expect(validate([...job, f('gst', '18%'), f('grandTotal', '₹5,900')])).toEqual([]);
      expect(validate([...job, f('cgst', '9%'), f('sgst', '9%'), f('grandTotal', '₹5,900')])).toEqual([]);
      expect(validate([...job, f('gst', '₹900 (18%)'), f('grandTotal', '₹5,900')])).toEqual([]);
      expect(findField(derive([...job, f('gst', '18%')]), ['grandTotal'])?.value).toBe('₹5,900');
    });
    it('subtracts a discount, before GST', () => {
      expect(validate([...job, f('discount', '₹200'), f('grandTotal', '₹4,800')])).toEqual([]);
      expect(validate([...job, f('discount', '200'), f('gst', '18%'), f('grandTotal', '₹5,664')])).toEqual([]);
      expect(validate([...job, f('discount', '₹200'), f('grandTotal', '₹5,000')])[0])
        .toMatch(/parts ₹4,000 \+ labour ₹1,000 − discount ₹200 \+ GST ₹0 = ₹4,800/);
    });
    it('skips the check, and the derived total, when only a GST rate field is printed', () => {
      expect(validate([...job, f('gstRate', '18', 'GST Rate'), f('grandTotal', '₹5,900')])).toEqual([]);
      const fields = [...job, f('gstRate', '18', 'GST Rate')];
      expect(derive(fields)).toBe(fields);
    });
  });
});
