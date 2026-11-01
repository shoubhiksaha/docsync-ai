import { medicalPrescription } from '@/modules/profiles/medical-prescription';
import type { RecordField } from '@/modules/profiles';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => medicalPrescription.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(medicalPrescription.validate!(fields));
const base = [f('doctorRegNo', 'UPMC-48213'), f('date', '20-10-2026')];

describe('profiles/medical-prescription', () => {
  it('meets the profile contract', () => {
    // The mock is dated as on the sample photo (26/10/2026), so check it within six months of that.
    jest.useFakeTimers({ now: new Date('2026-11-01T06:00:00Z') });
    try {
      expect(profileProblems(medicalPrescription)).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dates the mock prescription as printed on the sample', () => {
    expect(medicalPrescription.mockFields.find(m => m.key === 'date')?.value).toBe('26/10/2026');
    expect(medicalPrescription.duplicateKey).toBeUndefined();
  });

  it('reads a date written in Devanagari digits', () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T06:00:00Z') });
    try {
      expect(validate([f('doctorRegNo', '123'), f('date', '१५-१०-२०२६')])).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('derive', () => {
    it('masks a full Aadhaar number to its last 4 digits', () => {
      const out = derive([f('aadhaarNumber', '2345 6789 0123', 'Aadhaar Number'), f('patientName', 'Sunita')]);
      expect(out.find(x => x.key === 'aadhaarNumber')?.value).toBe('XXXX XXXX 0123');
      expect(out.find(x => x.key === 'patientName')?.value).toBe('Sunita');
    });
    it('leaves an already-masked Aadhaar alone', () => {
      const fields = [f('aadhar', 'XXXX XXXX 0123')];
      expect(derive(fields)).toBe(fields);
    });
    it('counts the medicines when Total Items is missing', () => {
      const out = derive([f('medicines', 'Tab A 500 mg – 1-0-1; Syp B – 5 ml TDS;\nCap C 20 mg; ')]);
      expect(out.find(x => x.key === 'totalItems')?.value).toBe('3');
    });
    it('keeps a written Total Items and leaves fields without medicines unchanged', () => {
      const written = [f('medicines', 'Tab A; Tab B'), f('totalItems', '2')];
      expect(derive(written)).toBe(written);
      const none = [f('patientName', 'Sunita')];
      expect(derive(none)).toBe(none);
    });
  });

  describe('validate', () => {
    // The age checks compare with today; pin today to 30 Oct 2026.
    beforeAll(() => {
      jest.useFakeTimers({ now: new Date('2026-10-30T06:00:00Z') });
    });
    afterAll(() => {
      jest.useRealTimers();
    });

    it('passes a complete, recent prescription', () => {
      expect(validate([...base, f('age', '42 yrs'), f('medicines', 'Tab A; Tab B'), f('totalItems', '2')])).toEqual([]);
    });
    it('warns when the registration number is missing', () => {
      expect(validate([f('date', '20-10-2026')])).toEqual([expect.stringMatching(/registration number.*Schedule H/)]);
    });
    it('warns when the date is missing or unreadable', () => {
      expect(validate([f('doctorRegNo', '123')])).toEqual([expect.stringMatching(/No prescription date/)]);
      expect(validate([f('doctorRegNo', '123'), f('date', '31-02-2026')])[0]).toMatch(/"31-02-2026" could not be read/);
      expect(validate([f('doctorRegNo', '123'), f('date', 'kal')])[0]).toMatch(/could not be read/);
    });
    it('reads a date with a Hindi month name or written month first', () => {
      expect(validate([f('doctorRegNo', '123'), f('date', '16 अक्टूबर 2026')])).toEqual([]);
      expect(validate([f('doctorRegNo', '123'), f('date', 'Oct 16, 2026')])).toEqual([]);
    });
    it('reads a date printed with a time', () => {
      expect(validate([f('doctorRegNo', '123'), f('date', '18-10-2026 10:30 AM')])).toEqual([]);
    });
    it('warns on a prescription older than about six months', () => {
      expect(validate([f('doctorRegNo', '123'), f('date', '2 Mar 2026')])[0]).toMatch(/more than 6 months ago/);
      expect(validate([f('doctorRegNo', '123'), f('date', '2026-05-15')])).toEqual([]);
    });
    it('warns on a future date', () => {
      expect(validate([f('doctorRegNo', '123'), f('date', '05/11/26')])[0]).toMatch(/in the future/);
      expect(validate([f('doctorRegNo', '123'), f('date', '31-Oct-2026')])).toEqual([]);
    });
    it('warns on an impossible age', () => {
      expect(validate([...base, f('age', '420')])[0]).toMatch(/age "420"/);
      expect(validate([...base, f('age', '-3')])[0]).toMatch(/age "-3"/);
      expect(validate([...base, f('age', 'adult')])).toEqual([]);
    });
    it('warns when Total Items does not match the medicines listed', () => {
      expect(validate([...base, f('medicines', 'Tab A; Tab B; Cap C'), f('totalItems', '2')])[0]).toMatch(/Total Items \(2\).*3 medicines/);
      expect(validate([...base, f('medicines', 'Tab A'), f('totalItems', 'one')])).toEqual([]);
    });
  });
});
