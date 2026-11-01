import type { RecordField } from '@/modules/profiles';
import { lorryReceipt } from '@/modules/profiles/lorry-receipt';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => lorryReceipt.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(lorryReceipt.validate!(fields));

describe('profiles/lorry-receipt', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(lorryReceipt)).toEqual([]);
  });

  it('passes its own sample, and keeps the e-way bill number unmasked', () => {
    expect(validate(lorryReceipt.mockFields)).toEqual([]);
    expect(lorryReceipt.mockFields.find(x => x.key === 'ewayBillNumber')?.category).not.toBe('identity');
  });

  describe('e-way bill', () => {
    it('accepts 12 digits with spaces or hyphens', () => {
      expect(validate([f('ewayBillNumber', '3612 4578 9012'), f('invoiceValue', '₹2,64,000')])).toEqual([]);
      expect(validate([f('ewbNo', '3612-4578-9012')])).toEqual([]);
    });
    it('flags a number that is not 12 digits', () => {
      expect(validate([f('ewayBillNumber', '3612 4578 901')])[0]).toMatch(/"3612 4578 901" should be exactly 12 digits/);
      expect(validate([f('ewayBill', 'EWB36124578901A')])[0]).toMatch(/12 digits/);
    });
    it('ignores a label copied in front of the number', () => {
      for (const eway of ['EWB 3612 4578 9012', 'EWB No. 361245789012', 'E-way Bill: 3612-4578-9012', 'ई-वे बिल नं. 3612 4578 9012']) {
        expect(validate([f('ewayBillNumber', eway)])).toEqual([]);
      }
      expect(validate([f('ewayBillNumber', 'EWB No. 3612 4578')])[0]).toMatch(/12 digits/);
    });
    it('warns when a consignment above ₹50,000 has no e-way bill', () => {
      const [warning] = validate([f('invoiceValue', '₹2,64,000')]);
      expect(warning).toMatch(/₹2,64,000 but no e-way bill/);
      expect(warning).toMatch(/normally/);
    });
    it('does not ask for an e-way bill at or below ₹50,000 or without a value', () => {
      expect(validate([f('invoiceValue', '50,000')])).toEqual([]);
      expect(validate([f('invoiceValue', 'as per invoice')])).toEqual([]);
    });
  });

  describe('GSTIN', () => {
    it('accepts valid GSTINs, ignoring case and spaces', () => {
      expect(validate([f('consignorGstin', '27AAKCK1234M1Z5'), f('consigneeGstin', '24aagfo 5678k1z2')])).toEqual([]);
    });
    it('flags each malformed GSTIN with its party', () => {
      const warnings = validate([f('consignorGstin', '27AAKCK1234M1Y5'), f('consigneeGST', '24AAGFO5678K')]);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/^Consignor GSTIN "27AAKCK1234M1Y5"/);
      expect(warnings[1]).toMatch(/^Consignee GSTIN "24AAGFO5678K"/);
    });
  });

  describe('vehicle number', () => {
    it('accepts standard and BH-series numbers', () => {
      expect(validate([f('vehicleNumber', 'GJ 05 BX 3391')])).toEqual([]);
      expect(validate([f('truckNo', '23 BH 4521 C')])).toEqual([]);
      expect(validate([f('lorryNo', 'UP 32 T 123')])).toEqual([]);
    });
    it('flags a malformed number', () => {
      expect(validate([f('vehicleNo', 'GJ-05')])[0]).toMatch(/"GJ-05" doesn't look like an Indian registration/);
    });
  });

  describe('weights', () => {
    it('flags a charged weight below the actual weight', () => {
      expect(validate([f('actualWeight', '3,000 kg'), f('chargedWeight', '2,800 kg')])[0])
        .toMatch(/Charged weight \(2800 kg\) is less than actual weight \(3000 kg\)/);
    });
    it('compares weights across kg, quintal and tonne units', () => {
      expect(validate([f('actualWeight', '3,000 kg'), f('chargedWeight', '3.2 MT')])).toEqual([]);
      expect(validate([f('actualWeight', '3,000 kg'), f('chargedWeight', '32 Qtl')])).toEqual([]);
      expect(validate([f('actualWeight', '31 क्विंटल'), f('chargedWeight', '3000')])[0]).toMatch(/\(3000 kg\) is less than actual weight \(3100 kg\)/);
      expect(validate([f('actualWeight', '2.9t'), f('chargedWeight', '2,800 kg')])[0]).toMatch(/actual weight \(2900 kg\)/);
    });
    it('skips the check when a weight is missing or not a number', () => {
      expect(validate([f('actualWeight', '3,000 kg'), f('chargedWeight', 'FTL')])).toEqual([]);
      expect(validate([f('chargedWeight', '2,800 kg')])).toEqual([]);
    });
  });

  it('returns nothing for an empty record', () => {
    expect(validate([])).toEqual([]);
  });

  describe('freight', () => {
    const lr = [f('chargedWeight', '3,200 kg'), f('rate', '₹3,000 per MT')];
    it('passes freight that equals charged weight × a per-weight rate', () => {
      expect(validate([...lr, f('freight', '₹9,600')])).toEqual([]);
      expect(validate([f('actualWeight', '32 Qtl'), f('rate', '300/Qtl'), f('freight', '9,600')])).toEqual([]);
      expect(validate([f('chargedWeight', '3.2 MT'), f('ratePerMt', '3000', 'Rate per MT'), f('freight', '9600')])).toEqual([]);
    });
    it('warns when freight does not match weight × rate', () => {
      expect(validate([...lr, f('freight', '₹12,000')])).toEqual([
        "Freight (₹12,000) doesn't match weight × rate (3,200 kg at ₹3,000 per MT = ₹9,600). Check the weight, the rate and the freight.",
      ]);
    });
    it('skips a rate per bag, per trip or without a basis', () => {
      for (const rate of ['₹40 per bag', '₹9,000 per trip', '₹9,000 fixed', '3000']) {
        expect(validate([f('chargedWeight', '3,200 kg'), f('rate', rate), f('freight', '₹12,000')])).toEqual([]);
      }
    });
    it('reads a weight with no unit in the unit its label names', () => {
      const rate = f('rate', '₹3,000 per MT');
      expect(validate([f('chargedWeight', '3.2', 'Charged Weight (MT)'), rate, f('freight', '₹9,600')])).toEqual([]);
      expect(validate([f('chargedWeight', '32', 'Charged Wt (Qtl)'), rate, f('freight', '₹9,600')])).toEqual([]);
      expect(validate([f('actualWeight', '3,000 kg'), f('chargedWeight', '3.2', 'Charged Weight (MT)')])).toEqual([]);
      const lr = [f('chargedWeight', '3.2', 'Charged Weight (MT)'), rate];
      expect(derive(lr)).toEqual([...lr, { key: 'freight', label: 'Freight', value: '9600', confidence: 100, category: 'financial' }]);
    });
    it('takes a bare weight in kg or in the rate\'s unit, whichever gives the freight, else skips', () => {
      const rate = f('rate', '₹3,000 per MT');
      expect(validate([f('chargedWeight', '3.2'), rate, f('freight', '₹9,600')])).toEqual([]);
      expect(validate([f('chargedWeight', '3200'), rate, f('freight', '₹9,600')])).toEqual([]);
      expect(validate([f('chargedWeight', '3.2'), rate, f('freight', '₹12,000')])).toEqual([]);
      const bare = [f('chargedWeight', '3.2'), rate];
      expect(derive(bare)).toBe(bare);
    });
    it('derives a missing freight, and keeps a written one', () => {
      expect(derive(lr)).toEqual([...lr, { key: 'freight', label: 'Freight', value: '9600', confidence: 100, category: 'financial' }]);
      const written = [...lr, f('freight', '₹9,500')];
      expect(derive(written)).toBe(written);
      const perTrip = [f('chargedWeight', '3,200 kg'), f('rate', '₹9,000 per trip')];
      expect(derive(perTrip)).toBe(perTrip);
    });
  });

  it('reads an invoice value written in lakh', () => {
    expect(validate([f('invoiceValue', '₹2.64 lakh')])[0]).toMatch(/Invoice value is ₹2,64,000 but no e-way bill/);
    expect(validate([f('invoiceValue', '2.64 लाख')])[0]).toMatch(/₹2,64,000/);
    expect(validate([f('invoiceValue', '₹45 हज़ार')])).toEqual([]);
  });
});
