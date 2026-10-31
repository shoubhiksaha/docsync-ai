import { findField, type RecordField } from '@/modules/profiles';
import { handicraftPieceRate as profile } from '@/modules/profiles/handicraft-piece-rate';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);

describe('profiles/handicraft-piece-rate', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('works out amount due from accepted pieces × rate, then net payable', () => {
      const out = derive([f('piecesCompleted', '115'), f('piecesRejected', '5'), f('ratePerPiece', '₹45'), f('advance', '₹1,000')]);
      expect(findField(out, ['amountDue'])?.value).toBe('4950');
      expect(findField(out, ['netPayable'])?.value).toBe('3950');
      expect(out).toHaveLength(6);
    });

    it('counts a blank rejected column as none', () => {
      expect(findField(derive([f('Completed', '40', 'Completed'), f('Rate', '12.5', 'Rate'), f('rejected', '—')]), ['amountDue'])?.value).toBe('500');
      expect(findField(derive([f('piecesCompleted', '40'), f('ratePerPiece', '12.5')]), ['netPayable'])).toBeUndefined();
    });

    it('keeps a written amount and net payable', () => {
      const fields = [f('piecesCompleted', '115'), f('ratePerPiece', '45'), f('amountDue', '5000'), f('advance', '1000'), f('netPayable', '4000')];
      expect(derive(fields)).toBe(fields);
    });

    it('works out net payable from a written amount', () => {
      expect(findField(derive([f('amount', '₹4,950'), f('advance', '1000')]), ['netPayable'])?.value).toBe('3950');
    });

    it('returns the fields unchanged when numbers are missing or unreadable', () => {
      const fields = [f('artisanName', 'Shabana'), f('piecesCompleted', 'many'), f('ratePerPiece', '45'), f('advance', 'nil')];
      expect(derive(fields)).toBe(fields);
      expect(derive([])).toEqual([]);
    });

    it('masks a full Aadhaar number and leaves other fields alone', () => {
      const out = derive([f('aadharNo', '1234 5678 9012', 'Aadhar No.'), f('artisanId', '123456789012')]);
      expect(out[0].value).toBe('XXXX XXXX 9012');
      expect(out[1].value).toBe('123456789012');
      const masked = [f('aadhaar', 'XXXX XXXX 9012', 'Aadhaar')];
      expect(derive(masked)).toBe(masked);
    });
  });

  describe('validate', () => {
    it('passes a consistent card', () => {
      expect(validate(profile.mockFields)).toEqual([]);
    });

    it('accepts small rounding in the amount', () => {
      expect(validate([f('piecesCompleted', '33'), f('ratePerPiece', '12.35'), f('amountDue', '408')])).toEqual([]);
    });

    it('warns when the amount does not match accepted pieces × rate', () => {
      const [w] = validate([f('piecesCompleted', '115'), f('piecesRejected', '5'), f('ratePerPiece', '45'), f('amountDue', '5,175')]);
      expect(w).toBe("Amount due (₹5,175) doesn't match 110 accepted pieces × ₹45 = ₹4,950. Please check the count and rate.");
    });

    it('warns when more pieces are completed than issued', () => {
      expect(validate([f('piecesIssued', '100'), f('piecesCompleted', '115')])[0]).toMatch(/completed \(115\) are more than pieces issued \(100\)/);
    });

    it('warns when more pieces are rejected than completed', () => {
      expect(validate([f('piecesCompleted', '10'), f('piecesRejected', '12')])[0]).toMatch(/rejected \(12\) are more than pieces completed \(10\)/);
    });

    it('warns when net payable is not amount − advance', () => {
      const [w] = validate([f('amountDue', '4950'), f('advance', '1000'), f('netPayable', '3,590')]);
      expect(w).toBe("Net payable (₹3,590) doesn't equal amount ₹4,950 − advance ₹1,000 = ₹3,950.");
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('piecesIssued', 'n/a'), f('piecesCompleted', '115'), f('ratePerPiece', '?'), f('amountDue', '4950')])).toEqual([]);
    });
  });
});
