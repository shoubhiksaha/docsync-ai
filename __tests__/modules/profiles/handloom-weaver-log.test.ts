import { findField, type RecordField } from '@/modules/profiles';
import { handloomWeaverLog as profile } from '@/modules/profiles/handloom-weaver-log';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/handloom-weaver-log', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('works out wages from pieces × rate per piece, then net paid', () => {
      const out = derive([f('piecesWoven', '6'), f('ratePerPiece', '₹450'), f('advance', '₹1,000')]);
      expect(findField(out, ['wages'])?.value).toBe('2700');
      expect(findField(out, ['netPaid'])?.value).toBe('1700');
      expect(out).toHaveLength(5);
    });

    it('works out wages from metres × rate per metre', () => {
      const out = derive([f('metresWoven', '33.5 m'), f('ratePerMetre', '82')]);
      expect(findField(out, ['wages'])?.value).toBe('2747');
      expect(findField(out, ['netPaid'])).toBeUndefined();
    });

    it('uses a plain rate when only one quantity is written', () => {
      expect(findField(derive([f('Pieces', '4', 'Pieces'), f('Rate', '500', 'Rate')]), ['wages'])?.value).toBe('2000');
    });

    it('does not guess wages when the rate could apply to pieces or metres', () => {
      const fields = [f('pieces', '6'), f('metres', '33'), f('rate', '450')];
      expect(derive(fields)).toBe(fields);
    });

    it('keeps written wages and net paid', () => {
      const fields = [f('piecesWoven', '6'), f('ratePerPiece', '450'), f('wages', '2600'), f('advance', '500'), f('netPaid', '2100')];
      expect(derive(fields)).toBe(fields);
    });

    it('works out net paid from written wages', () => {
      expect(findField(derive([f('wages', '₹2,700'), f('advance', '1000')]), ['netPaid'])?.value).toBe('1700');
    });

    it('returns the fields unchanged when numbers are missing or unreadable', () => {
      const fields = [f('weaverName', 'Sitaram'), f('piecesWoven', 'six'), f('ratePerPiece', '450'), f('advance', 'nil')];
      expect(derive(fields)).toBe(fields);
      expect(derive([])).toEqual([]);
    });

    it('masks a full Aadhaar number and leaves other fields alone', () => {
      const out = derive([f('aadhaarNumber', '1234 5678 9012', 'Aadhaar No.'), f('weaverId', '123456789012')]);
      expect(out[0].value).toBe('XXXX XXXX 9012');
      expect(out[1].value).toBe('123456789012');
    });

    it('leaves an already-masked Aadhaar as it is', () => {
      const fields = [f('aadhar', 'XXXX XXXX 9012', 'Aadhar')];
      expect(derive(fields)).toBe(fields);
      expect(derive([f('aadharNo', '1234-5678-9012', 'Aadhar No')])[0].value).toBe('XXXX XXXX 9012');
      expect(derive([f('adhaar', '123456789012', 'Adhaar')])[0].value).toBe('XXXX XXXX 9012');
    });
  });

  describe('validate', () => {
    it('passes a consistent log', () => {
      expect(validate(profile.mockFields)).toEqual([]);
      expect(validate([f('metresWoven', '33'), f('ratePerMetre', '82'), f('wages', '2706')])).toEqual([]);
    });

    it('accepts small rounding in wages', () => {
      expect(validate([f('metresWoven', '33.3'), f('ratePerMetre', '82'), f('wages', '2731')])).toEqual([]);
    });

    it('accepts a plain rate that matches either pieces or metres', () => {
      expect(validate([f('pieces', '6'), f('metres', '33'), f('rate', '82'), f('wages', '2706')])).toEqual([]);
    });

    it('warns when wages do not match quantity × rate', () => {
      const [w] = validate([f('piecesWoven', '6'), f('ratePerPiece', '450'), f('wages', '2,500')]);
      expect(w).toContain('Wages (₹2,500)');
      expect(w).toContain('6 pieces × ₹450 = ₹2,700');
    });

    it('warns when net paid is not wages − advance', () => {
      const [w] = validate([f('wages', '2700'), f('advance', '1000'), f('netPaid', '1800')]);
      expect(w).toMatch(/Net paid \(₹1,800\) doesn't equal wages ₹2,700 − advance ₹1,000 = ₹1,700/);
    });

    it('warns when more yarn is consumed than issued', () => {
      expect(validate([f('yarnIssued', '4.5 kg'), f('yarnConsumed', '4.8 kg')])[0]).toMatch(/consumed \(4.8 kg\) is more than yarn issued \(4.5 kg\)/);
    });

    it('warns when more yarn is returned than issued', () => {
      expect(validate([f('yarnIssued', '4.5'), f('yarnReturned', '5')])[0]).toMatch(/returned \(5 kg\) is more than yarn issued/);
    });

    it('warns when consumed + returned exceeds issued', () => {
      expect(validate([f('yarnIssued', '4.5'), f('yarnConsumed', '4.2'), f('yarnReturned', '0.5')])[0]).toMatch(/consumed \(4.2 kg\) \+ returned \(0.5 kg\)/);
      expect(validate([f('yarnIssued', '4.5'), f('yarnConsumed', '4.2'), f('yarnReturned', '0.3')])).toEqual([]);
    });

    it('warns when cloth is received before the yarn was issued', () => {
      expect(validate([f('dateIssued', '16-10-2026'), f('dateReceived', '02/10/2026')])[0]).toMatch(/Date received \(02\/10\/2026\) is before date issued \(16-10-2026\)/);
      expect(validate([f('dateIssued', '2026-10-16'), f('dateReceived', '2 Oct 26')])).toHaveLength(1);
    });

    it('accepts dates in order and ignores dates it cannot read', () => {
      expect(validate([f('dateIssued', '2 Oct 2026'), f('dateReceived', '16.10.2026')])).toEqual([]);
      expect(validate([f('dateIssued', '16-13-2026'), f('dateReceived', '02-10-2026')])).toEqual([]);
      expect(validate([f('dateIssued', '16 Foo 2026'), f('dateReceived', '02-10-2026')])).toEqual([]);
      expect(validate([f('dateIssued', 'Diwali'), f('dateReceived', '02-10-2026')])).toEqual([]);
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('wages', '—'), f('piecesWoven', '6'), f('ratePerPiece', '450'), f('yarnIssued', 'n/a'), f('yarnConsumed', '4')])).toEqual([]);
    });
  });
});
