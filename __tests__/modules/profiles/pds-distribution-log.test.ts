import { findField, type RecordField } from '@/modules/profiles';
import { pdsDistributionLog as profile } from '@/modules/profiles/pds-distribution-log';
import { profileProblems, ruleTexts } from '../../helpers/profile-contract';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });
const derive = (fields: RecordField[]) => profile.derive!(fields);
const validate = (fields: RecordField[]) => ruleTexts(profile.validate!(fields));

describe('profiles/pds-distribution-log', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(profile)).toEqual([]);
  });

  describe('derive', () => {
    it('masks a full Aadhaar number to the last 4 digits, by key or label', () => {
      const out = derive([f('aadhaarNumber', '1234 5678 9012'), f('id', '2345-6789-0123', 'Aadhar No.'), f('x', '345678901234', 'UID')]);
      expect(out.map(x => x.value)).toEqual(['XXXX XXXX 9012', 'XXXX XXXX 0123', 'XXXX XXXX 1234']);
    });

    it('leaves already-masked or non-Aadhaar values alone', () => {
      const fields = [f('aadhaar', 'XXXX XXXX 9012'), f('rationCardNumber', '123456789012'), f('guide', '123456789012')];
      expect(derive(fields)).toBe(fields);
    });

    it('adds total grain from rice and wheat, treating a missing one as zero', () => {
      expect(findField(derive([f('riceKg', '12 kg'), f('wheatKg', '8')]), ['totalGrainKg'])?.value).toBe('20');
      expect(findField(derive([f('rice', '35')]), ['totalGrainKg'])?.value).toBe('35');
      expect(findField(derive([f('gehun', '10')]), ['totalGrainKg'])?.value).toBe('10');
    });

    it('keeps a stated total and skips unreadable quantities', () => {
      const stated = [f('riceKg', '12'), f('totalGrainKg', '20')];
      expect(derive(stated)).toBe(stated);
      const unreadable = [f('riceKg', 'nil')];
      expect(derive(unreadable)).toBe(unreadable);
    });

    it('keeps every field when it both masks and adds', () => {
      const out = derive([f('aadhaar', '123456789012'), f('riceKg', '5')]);
      expect(out).toHaveLength(3);
      expect(out[0].value).toBe('XXXX XXXX 9012');
    });
  });

  describe('validate', () => {
    it('passes entitlement-sized PHH and AAY lines', () => {
      expect(validate(profile.mockFields)).toEqual([]);
      expect(validate([f('cardType', 'Antyodaya (AAY)'), f('riceKg', '20'), f('wheatKg', '15')])).toEqual([]);
    });

    it('warns when a PHH card gets more than 5 kg per member', () => {
      const w = validate([f('cardType', 'Priority Household'), f('members', '4'), f('riceKg', '15'), f('wheatKg', '10')]);
      expect(w[0]).toMatch(/PHH cards normally get up to 5 kg .*4 members → 20 kg.*25 kg/);
    });

    it('warns when an AAY card gets more than 35 kg', () => {
      expect(validate([f('cardType', 'AAY'), f('riceKg', '40')])[0]).toMatch(/AAY cards normally get up to 35 kg .*40 kg/);
    });

    it('stays quiet without card type, quantities or members', () => {
      expect(validate([f('cardType', 'NPHH'), f('members', '2'), f('riceKg', '100')])).toEqual([]);
      expect(validate([f('cardType', 'Non-Priority'), f('members', '2'), f('riceKg', '100')])).toEqual([]);
      expect(validate([f('riceKg', '100')])).toEqual([]);
      expect(validate([f('cardType', 'AAY')])).toEqual([]);
      expect(validate([f('cardType', 'PHH'), f('riceKg', '100')])).toEqual([]);
      expect(validate([f('cardType', 'PHH'), f('members', '0'), f('wheatKg', '100')])).toEqual([]);
    });
  });

  it('reads card types written in Hindi or Hinglish', () => {
    for (const card of ['अंत्योदय', 'अन्त्योदय', 'Antyodaya', 'AAY']) {
      expect(validate([f('cardType', card), f('riceKg', '50')])[0]).toMatch(/AAY cards .* 35 kg/);
      expect(validate([f('cardType', card), f('riceKg', '35')])).toEqual([]);
    }
    for (const card of ['पात्र गृहस्थी', 'प्राथमिकता', 'Patra Grihasthi', 'PHH']) {
      expect(validate([f('cardType', card), f('members', '2'), f('riceKg', '30')])[0]).toMatch(/2 members → 10 kg/);
      expect(validate([f('cardType', card), f('members', '2'), f('riceKg', '10')])).toEqual([]);
    }
    for (const card of ['सामान्य', 'APL', 'NPHH', 'अपात्र गृहस्थी', 'गैर प्राथमिकता']) {
      expect(validate([f('cardType', card), f('members', '2'), f('riceKg', '100')])).toEqual([]);
    }
  });
  it('counts millets and maize as grain, but not sugar or dal', () => {
    const card = [f('cardType', 'PHH'), f('members', '4'), f('riceKg', '12'), f('wheatKg', '8')];
    expect(validate([...card, f('bajra', '5')])[0]).toMatch(/20 kg.*25 kg of grain/);
    expect(validate([...card, f('sugarKg', '2'), f('dalKg', '1')])).toEqual([]);
    expect(profile.derive!([...card, f('ragiKg', '3')]).find(x => x.key === 'totalGrainKg')?.value).toBe('23');
    expect(profile.derive!([f('makka', '10', 'Makka')]).find(x => x.key === 'totalGrainKg')?.value).toBe('10');
  });
});
