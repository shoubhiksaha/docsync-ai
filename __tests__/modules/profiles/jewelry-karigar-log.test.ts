import { findField, type RecordField } from '@/modules/profiles';
import { jewelryKarigarLog as profile } from '@/modules/profiles/jewelry-karigar-log';
import { profileProblems } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => profile.validate!(fields);

describe('profiles/jewelry-karigar-log', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  it('derives wastage % for the mock card', () => {
    expect(findField(derive(profile.mockFields), ['wastagePercent'])?.value).toBe('3.5');
  });

  describe('derive', () => {
    it('works out wastage grams and % from issued, finished and stone weights', () => {
      const out = derive([f('metalIssued', '20.000 g'), f('finishedWeight', '20.150 g'), f('stoneWeight', '0.850 g')]);
      expect(findField(out, ['wastageGrams'])?.value).toBe('0.7');
      expect(findField(out, ['wastagePercent'])?.value).toBe('3.5');
      expect(out).toHaveLength(5);
    });

    it('treats missing stones as none and allows for metal returned', () => {
      const out = derive([f('goldIssued', '50'), f('finishedWeight', '19'), f('metalReturned', '30')]);
      expect(findField(out, ['wastageGrams'])?.value).toBe('1');
      expect(findField(out, ['wastagePercent'])?.value).toBe('5');
    });

    it('keeps written wastage grams and % and tells them apart', () => {
      const fields = [f('metalIssued', '20'), f('finishedWeight', '19.5'), f('wastage', '0.5', 'Wastage (g)'), f('wastage_pct', '2.5', 'Wastage %')];
      expect(derive(fields)).toBe(fields);
    });

    it('adds only the % when grams are written', () => {
      const out = derive([f('metalIssued', '10'), f('finishedWeight', '9.6'), f('ghat', '0.4', 'Ghat')]);
      expect(out).toHaveLength(4);
      expect(findField(out, ['wastagePercent'])?.value).toBe('4');
    });

    it('adds only the grams when % is written', () => {
      const out = derive([f('metalIssued', '10'), f('finishedWeight', '9.6'), f('wastagePercent', '4', 'Wastage %')]);
      expect(out).toHaveLength(4);
      expect(findField(out, ['wastageGrams'])?.value).toBe('0.4');
    });

    it('does not derive a negative wastage', () => {
      const fields = [f('metalIssued', '10'), f('finishedWeight', '10.5')];
      expect(derive(fields)).toBe(fields);
    });

    it('rounds a hair below zero to zero wastage', () => {
      expect(findField(derive([f('metalIssued', '10'), f('finishedWeight', '10.0004')]), ['wastageGrams'])?.value).toBe('0');
    });

    it('skips % when nothing was used', () => {
      const out = derive([f('metalIssued', '10'), f('metalReturned', '10'), f('finishedWeight', '0')]);
      expect(findField(out, ['wastageGrams'])?.value).toBe('0');
      expect(findField(out, ['wastagePercent'])).toBeUndefined();
    });

    it('returns the fields unchanged when weights are missing or unreadable', () => {
      const fields = [f('metalIssued', 'twenty'), f('finishedWeight', '19')];
      expect(derive(fields)).toBe(fields);
      expect(derive([f('wastage', '—', 'Wastage')])).toHaveLength(1);
      expect(derive([])).toEqual([]);
    });
  });

  describe('validate', () => {
    it('passes a consistent card', () => {
      expect(validate(derive(profile.mockFields))).toEqual([]);
      expect(validate([f('metalIssued', '50'), f('finishedWeight', '19'), f('metalReturned', '30'), f('wastage', '1')])).toEqual([]);
    });

    it('warns when the finished metal is more than the metal issued', () => {
      const [w] = validate([f('metalIssued', '10'), f('finishedWeight', '11'), f('stoneWeight', '0.5')]);
      expect(w).toBe('Metal accounted for (10.5 g: finished 11 g − stones 0.5 g) is more than the metal issued (10 g). Please check the weights.');
      expect(validate([f('metalIssued', '10'), f('finishedWeight', '6'), f('metalReturned', '4.5')])[0]).toContain('finished 6 g + returned 4.5 g');
    });

    it('warns when written wastage does not match the weights', () => {
      const [w] = validate([f('metalIssued', '20'), f('finishedWeight', '19.5'), f('wastageGrams', '0.2')]);
      expect(w).toMatch(/Wastage \(0.2 g\) doesn't equal .* = 0.5 g/);
    });

    it('accepts written wastage within 0.01 g', () => {
      expect(validate([f('metalIssued', '20'), f('finishedWeight', '19.5'), f('wastageGrams', '0.505')])).toEqual([]);
    });

    it('asks to check wastage above about 8%', () => {
      expect(validate([f('metalIssued', '10'), f('finishedWeight', '9')])[0]).toMatch(/Wastage is 10% of the metal used.*about 8%/);
      expect(validate([f('wastagePercent', '9.5 %', 'Wastage %')])[0]).toMatch(/9.5%/);
      expect(validate([f('metalIssued', '10'), f('finishedWeight', '9.2'), f('wastage', '0.8')])).toEqual([]);
    });

    it('prefers a written % over working it out', () => {
      expect(validate([f('metalIssued', '10'), f('finishedWeight', '9.5'), f('wastagePercent', '5', 'Wastage %')])).toEqual([]);
    });

    it('reads a plain "Wastage" written as a percent as a percent, not grams', () => {
      const fields = [f('metalIssued', '20'), f('finishedWeight', '19.3'), f('wastage', '3.5%', 'Wastage')];
      expect(validate(fields)).toEqual([]);
      expect(validate([f('metalIssued', '20'), f('finishedWeight', '19.3'), f('wastage', '3.5 प्रतिशत', 'घट')])).toEqual([]);
      const out = derive(fields);
      expect(findField(out, ['wastageGrams'])?.value).toBe('0.7');
      expect(findField(out, ['wastagePercent'])).toBeUndefined();
    });

    it('keeps a grams value that also mentions a percent in grams', () => {
      expect(validate([f('metalIssued', '20'), f('finishedWeight', '19.3'), f('wastage', '0.7 g (3.5%)', 'Wastage')])).toEqual([]);
    });

    it('warns when a written % is clearly not wastage ÷ metal used', () => {
      expect(validate([f('metalIssued', '20'), f('finishedWeight', '19.3'), f('wastagePercent', '6', 'Wastage %')])).toEqual([
        "Wastage % (6%) doesn't equal wastage ÷ metal used (0.7 g ÷ 20 g = 3.5%). Please check it.",
      ]);
      expect(validate([f('metalIssued', '20'), f('finishedWeight', '19.3'), f('wastagePercent', '3.6', 'Wastage %')])).toEqual([]);
    });

    it('checks that karat and fineness agree', () => {
      expect(validate([f('purity', '22K/750')])[0]).toBe('Purity "22K/750" mixes 22K with 750 fineness (22K is normally 916). Please check it.');
      expect(validate([f('tunch', '24 KT 958', 'Tunch')])[0]).toMatch(/normally 999\/995/);
      for (const ok of ['22K / 916', '18 kt 750', '916', '22K', 'Silver 925', '20K 833']) {
        expect(validate([f('purity', ok)])).toEqual([]);
      }
    });

    it('warns when the ornament is returned before the metal was issued', () => {
      expect(validate([f('dateIssued', '14-10-2026'), f('dateReturned', '05/10/2026')])[0]).toMatch(/Date returned \(05\/10\/2026\) is before date issued \(14-10-2026\)/);
      expect(validate([f('date', '2026-10-14'), f('returnDate', '5 Oct 26')])).toHaveLength(1);
    });

    it('accepts dates in order and ignores dates it cannot read', () => {
      expect(validate([f('dateIssued', '5 Oct 2026'), f('dateReturned', '14.10.2026')])).toEqual([]);
      expect(validate([f('dateIssued', '14-13-2026'), f('dateReturned', '05-10-2026')])).toEqual([]);
      expect(validate([f('dateIssued', '14 Xyz 2026'), f('dateReturned', '05-10-2026')])).toEqual([]);
      expect(validate([f('dateIssued', 'Dhanteras'), f('dateReturned', '05-10-2026')])).toEqual([]);
    });

    it('stays quiet when values are missing or unreadable', () => {
      expect(validate([])).toEqual([]);
      expect(validate([f('metalIssued', 'n/a'), f('finishedWeight', '19'), f('wastage', 'nil')])).toEqual([]);
    });
  });
});
