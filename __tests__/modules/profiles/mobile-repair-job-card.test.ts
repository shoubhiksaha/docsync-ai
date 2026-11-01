import { mobileRepairJobCard } from '@/modules/profiles/mobile-repair-job-card';
import type { RecordField } from '@/modules/profiles';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => mobileRepairJobCard.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(mobileRepairJobCard.validate!(fields));
const VALID_IMEI = '352917114827362';
const VALID_IMEI_2 = '352917114827446';

describe('profiles/mobile-repair-job-card', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(mobileRepairJobCard)).toEqual([]);
    expect(mobileRepairJobCard.duplicateKey).toBe('jobCardNumber');
  });

  describe('derive', () => {
    it('adds the balance from total − advance', () => {
      const out = derive([f('totalAmount', '₹3,200'), f('advance', '1,000')]);
      expect(out.find(x => x.key === 'balance')?.value).toBe('2200');
      expect(out).toHaveLength(3);
    });
    it('keeps a written balance', () => {
      const fields = [f('totalAmount', '3200'), f('advance', '1000'), f('baki', '2000')];
      expect(derive(fields)).toBe(fields);
    });
    it('returns the fields unchanged when total or advance is missing or unreadable', () => {
      const missing = [f('totalAmount', '3200')];
      expect(derive(missing)).toBe(missing);
      const unreadable = [f('totalAmount', 'later'), f('advance', '500')];
      expect(derive(unreadable)).toBe(unreadable);
    });
  });

  describe('validate', () => {
    it('passes a consistent job card', () => {
      expect(validate([
        f('imei', `${VALID_IMEI} / ${VALID_IMEI_2}`), f('totalAmount', '3200'), f('advance', '1000'), f('balance', '2200'),
        f('date', '27-10-2026'), f('deliveryDate', '29 Oct 2026'), f('phone', '+91-98765-42563'),
      ])).toEqual([]);
    });
    it('accepts an IMEI written with spaces', () => {
      expect(validate([f('IMEI No', '35 291711 482736 2', 'IMEI No')])).toEqual([]);
    });
    it('warns when the IMEI is not 15 digits', () => {
      expect(validate([f('imei', '35291711482736')])[0]).toMatch(/has 14 digits/);
    });
    it('warns when the IMEI check digit is wrong', () => {
      expect(validate([f('imei', '352917114827363')])[0]).toMatch(/352917114827363 fails the check-digit/);
    });
    it('ignores empty pieces of a dual-IMEI value', () => {
      expect(validate([f('imei', `${VALID_IMEI} / -`)])).toEqual([]);
    });
    it('does not count the 1 or 2 of an "IMEI 1:" label as a digit', () => {
      expect(validate([f('imei', `IMEI 1: ${VALID_IMEI}`)])).toEqual([]);
      expect(validate([f('imei', `IMEI1: ${VALID_IMEI} IMEI2: ${VALID_IMEI_2}`)])).toEqual([]);
      expect(validate([f('imei', `IMEI-2 ${VALID_IMEI_2}`)])).toEqual([]);
      expect(validate([f('imei', 'IMEI 1: 35291711482736')])[0]).toMatch(/has 14 digits/);
    });
    it('warns when the advance is more than the total', () => {
      expect(validate([f('total', '500'), f('advance', '800'), f('balance', '-300')])).toEqual([
        expect.stringMatching(/Advance \(₹800\) is more than the total \(₹500\)/),
      ]);
    });
    it('warns when the balance does not equal total − advance', () => {
      expect(validate([f('total', '3200'), f('advance', '1000'), f('balance', '2000')])[0]).toMatch(/Balance \(₹2,000\).*= ₹2,200/);
    });
    it('skips the balance check when it is not written', () => {
      expect(validate([f('total', '3200'), f('advance', '1000')])).toEqual([]);
      expect(validate([f('total', '3200'), f('balance', '1')])).toEqual([]);
    });
    it('warns when delivery is before the job date', () => {
      expect(validate([f('date', '27/10/26'), f('deliveryDate', '2026-10-25')])[0]).toMatch(/Delivery date \(2026-10-25\) is before the job date \(27\/10\/26\)/);
    });
    it('ignores unreadable or impossible dates', () => {
      expect(validate([f('date', '27-13-2026'), f('deliveryDate', '01-01-2026')])).toEqual([]);
      expect(validate([f('date', '27-Xyz-2026'), f('deliveryDate', '01-01-2026')])).toEqual([]);
      expect(validate([f('date', 'aaj'), f('deliveryDate', '01-01-2026')])).toEqual([]);
    });
    it('warns on a malformed phone number', () => {
      expect(validate([f('mobile', '98765')])[0]).toMatch(/Phone "98765"/);
    });
    it('returns no warnings for an empty card', () => {
      expect(validate([])).toEqual([]);
    });
  });
  it('uses the total, not an estimate written above it', () => {
    const card = [f('estimate', '1500'), f('totalAmount', '1800'), f('advance', '500')];
    expect(validate([...card, f('balance', '1300')])).toEqual([]);
    expect(mobileRepairJobCard.derive!(card).find(x => x.key === 'balance')?.value).toBe('1300');
  });
});
