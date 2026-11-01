import type { RecordField } from '@/modules/profiles';
import {
  amountValue,
  isAadhaarField,
  isGstin,
  isMobileNumber,
  isVehicleNumber,
  maskAadhaar,
  maskAadhaarFields,
  maskAadhaarInText,
  moneyClose,
  parseIndianDate,
  quantityInRateUnits,
  rateBasis,
  rupees,
  signedAmount,
  weightKg,
} from '@/modules/profiles/checks';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });

describe('profiles/checks', () => {
  describe('rupees', () => {
    it('formats with Indian grouping and at most 2 decimals', () => {
      expect(rupees(150000)).toBe('₹1,50,000');
      expect(rupees(1234.5)).toBe('₹1,234.5');
      expect(rupees(12.345)).toBe('₹12.35');
      expect(rupees(-200)).toBe('−₹200');
      expect(rupees(0)).toBe('₹0');
    });
  });

  describe('moneyClose', () => {
    it('allows ₹1 on small amounts', () => {
      expect(moneyClose(10, 11)).toBe(true);
      expect(moneyClose(10, 11.5)).toBe(false);
    });
    it('allows 1% on large amounts, measured against b', () => {
      expect(moneyClose(9900, 10000)).toBe(true);
      expect(moneyClose(9899, 10000)).toBe(false);
      expect(moneyClose(-9900, -10000)).toBe(true);
    });
  });

  describe('isMobileNumber', () => {
    it.each(['9876543210', '98765 43210', '98765-43210', '+91 98765 43210', '+91-9876543210', '+919876543210', '09876543210', '6123456789'])(
      'accepts %s', v => expect(isMobileNumber(v)).toBe(true),
    );
    it.each(['5876543210', '987654321', '98765432101', '+92 98765 43210', '0091 9876543210', '98765 4321O', ''])(
      'rejects %s', v => expect(isMobileNumber(v)).toBe(false),
    );
    it('reads Devanagari digits', () => expect(isMobileNumber('९८७६५ ४३२१०')).toBe(true));
  });

  describe('isGstin', () => {
    it.each(['27ABCDE1234F1Z5', '09abcde1234f1z5', '23 AKSPK 4521 M1Z8'])('accepts %s', v => expect(isGstin(v)).toBe(true));
    it.each(['27ABCDE1234F1Y5', '27ABCDE1234F0Z5', '27ABCDE1234F1Z', 'AB12345678CDEFG', '27-ABCDE-1234-F1Z5'])(
      'rejects %s', v => expect(isGstin(v)).toBe(false),
    );
  });

  describe('isVehicleNumber', () => {
    it.each(['MH 12 AB 1234', 'DL 3C AB 1234', 'UP 32 T 123', '22 BH 1234 AA', 'mh-12-ab-1234', 'ka.05.mn.0712', 'GJ05BX3391', 'DL 1 C 5', 'MH 12 1234'])(
      'accepts %s', v => expect(isVehicleNumber(v)).toBe(true),
    );
    it.each(['GJ-05', '12345', 'MH 12 1234 AB X', '22 BH 12 A', 'MH 12 ABCD 1234', 'MH 12 AB 12345', 'MH 123', ''])(
      'rejects %s', v => expect(isVehicleNumber(v)).toBe(false),
    );
  });

  describe('isAadhaarField', () => {
    it('recognises Aadhaar by key, label, Hindi label or UID', () => {
      expect(isAadhaarField(f('aadhaarNumber', ''))).toBe(true);
      expect(isAadhaarField(f('idProof', '', 'Adhar No.'))).toBe(true);
      expect(isAadhaarField(f('idProof', '', 'आधार नंबर'))).toBe(true);
      expect(isAadhaarField(f('uid', ''))).toBe(true);
      expect(isAadhaarField(f('x', '', 'UID Number'))).toBe(true);
    });
    it('ignores other fields, including ones that merely contain "uid"', () => {
      expect(isAadhaarField(f('rationCardNumber', ''))).toBe(false);
      expect(isAadhaarField(f('guide', '', 'Guide'))).toBe(false);
      expect(isAadhaarField({ key: 'x', value: '' } as unknown as RecordField)).toBe(false);
    });
  });

  describe('maskAadhaar', () => {
    it('masks a 12-digit Aadhaar named by key', () => {
      expect(maskAadhaar(f('aadhaarNumber', '2345 6789 0123'))).toEqual(f('aadhaarNumber', 'XXXX XXXX 0123'));
    });
    it('masks by English label, Hindi label and UID key', () => {
      expect(maskAadhaar(f('idProof', '2345-6789-0123', 'Aadhar No.')).value).toBe('XXXX XXXX 0123');
      expect(maskAadhaar(f('idProof', '345678901234', 'आधार नंबर')).value).toBe('XXXX XXXX 1234');
      expect(maskAadhaar(f('uid', '4567 8901 2345', 'ID')).value).toBe('XXXX XXXX 2345');
    });
    it('ignores every separator and masks misread numbers too', () => {
      expect(maskAadhaar(f('aadhaar', '1234.5678.9012')).value).toBe('XXXX XXXX 9012');
      expect(maskAadhaar(f('aadhaar', 'UID: 1234/5678/9012')).value).toBe('XXXX XXXX 9012');
      expect(maskAadhaar(f('aadhaar', '12345678901')).value).toBe('XXXX XXXX 8901');
      expect(maskAadhaar(f('aadhaar', '1234567890123')).value).toBe('XXXX XXXX 0123');
    });
    it('masks a number written in Devanagari or other Indian digits', () => {
      expect(maskAadhaar(f('aadhaarNumber', '२३४५ ६७८९ ०१२३', 'Aadhaar No')).value).toBe('XXXX XXXX 0123');
      expect(maskAadhaar(f('idProof', '२३४५६७८९०१२३', 'आधार नंबर')).value).toBe('XXXX XXXX 0123');
      expect(maskAadhaar(f('aadhaar', '২৩৪৫ ৬৭৮৯ ০১২৩')).value).toBe('XXXX XXXX 0123');
    });
    it('keeps the rest of the field', () => {
      const field = { ...f('aadhaar', '123456789012'), confidence: 90, category: 'identity' };
      expect(maskAadhaar(field)).toEqual({ ...field, value: 'XXXX XXXX 9012' });
    });
    it('returns the same field when nothing should change', () => {
      const cases = [
        f('rationCardNumber', '123456789012'),
        f('aadhaar', 'XXXX XXXX 9012'),
        f('aadhaar', 'Not shown'),
        { key: 'aadhaar', label: 'Aadhaar' } as unknown as RecordField,
      ];
      for (const field of cases) expect(maskAadhaar(field)).toBe(field);
    });
  });

  describe('maskAadhaarInText', () => {
    it('masks every standalone 12-digit run, grouped or not', () => {
      expect(maskAadhaarInText('Ramesh (Aadhaar 234567890123) – 6; Sita 3456 7890 1234; Mohan 4567-8901-2345; Ravi 5678.9012.3456'))
        .toBe('Ramesh (Aadhaar XXXX XXXX 0123) – 6; Sita XXXX XXXX 1234; Mohan XXXX XXXX 2345; Ravi XXXX XXXX 3456');
    });
    it('leaves shorter, longer and already-masked numbers alone', () => {
      const text = 'Phone 9876543210, account 1234567890123, XXXX XXXX 0123';
      expect(maskAadhaarInText(text)).toBe(text);
    });
    it('masks a number written in Devanagari digits and keeps the rest of the text as written', () => {
      expect(maskAadhaarInText('रमेश (आधार २३४५ ६७८९ ०१२३) – ६ दिन')).toBe('रमेश (आधार XXXX XXXX 0123) – ६ दिन');
      expect(maskAadhaarInText('फ़ोन ९८७६५४३२१०')).toBe('फ़ोन ९८७६५४३२१०');
    });
  });

  describe('maskAadhaarFields', () => {
    it('masks Aadhaar fields and returns the same array when there is nothing to mask', () => {
      const clean = [f('ewayBillNumber', '3612 4578 9012'), f('name', 'Asha')];
      expect(maskAadhaarFields(clean)).toBe(clean);
      expect(maskAadhaarFields([...clean, f('aadhaarNo', '2345 6789 0123')]).map(x => x.value))
        .toEqual(['3612 4578 9012', 'Asha', 'XXXX XXXX 0123']);
    });
  });

  describe('signedAmount', () => {
    it('reads a balance in the customer\'s favour as negative', () => {
      expect(signedAmount('-₹200')).toBe(-200);
      expect(signedAmount('- Rs 200/-')).toBe(-200);
      expect(signedAmount('₹200 advance')).toBe(-200);
      expect(signedAmount('200 Cr')).toBe(-200);
      expect(signedAmount('₹200 (adv.)')).toBe(-200);
      expect(signedAmount('₹200 जमा अधिक')).toBe(-200);
      expect(signedAmount('-200')).toBe(-200);
    });
    it('leaves ordinary amounts positive', () => {
      expect(signedAmount('₹590')).toBe(590);
      expect(signedAmount('Rs 1,200/-')).toBe(1200);
      expect(signedAmount('₹200 credit')).toBe(200);
      expect(signedAmount('nil')).toBeNull();
      expect(signedAmount(undefined)).toBeNull();
    });
    it('reads lakh, but never takes "Cr" on a balance as crore', () => {
      expect(signedAmount('₹1.2 lakh')).toBe(120000);
      expect(signedAmount('-₹1.2 lakh')).toBe(-120000);
      expect(signedAmount('1.5 Cr')).toBe(-1.5);
      expect(signedAmount('2 crore')).toBe(20000000);
    });
  });

  describe('amountValue', () => {
    it('scales amounts written in lakh, crore or thousand', () => {
      expect(amountValue('₹2.64 lakh')).toBe(264000);
      expect(amountValue('Rs 2.64 Lakhs')).toBe(264000);
      expect(amountValue('2.64 L')).toBe(264000);
      expect(amountValue('₹१.५ लाख')).toBe(150000);
      expect(amountValue('1.2 crore')).toBe(12000000);
      expect(amountValue('₹1.2 Cr')).toBe(12000000);
      expect(amountValue('3 करोड़')).toBe(30000000);
      expect(amountValue('3.5k')).toBe(3500);
      expect(amountValue('4 हज़ार')).toBe(4000);
      expect(amountValue('4 hazaar')).toBe(4000);
    });
    it('leaves other amounts as parseNumber reads them', () => {
      expect(amountValue('₹2,64,000')).toBe(264000);
      expect(amountValue('₹590.50')).toBe(590.5);
      expect(amountValue('500 kg')).toBe(500);
      expect(amountValue('5 l')).toBe(5);
      expect(amountValue('₹200 credit')).toBe(200);
      expect(amountValue(1540)).toBe(1540);
      expect(amountValue('nil')).toBeNull();
      expect(amountValue('200 Cr', { crore: false })).toBe(200);
    });
    it('reads "Cr" after a large or grouped figure as a credit column, not crore', () => {
      expect(amountValue('₹1,540 Cr')).toBe(1540);
      expect(amountValue('₹500 Cr')).toBe(500);
      expect(amountValue('₹12 Cr')).toBe(120000000);
      expect(amountValue('₹1,540 crore')).toBe(15400000000);
    });
  });

  describe('rate basis', () => {
    it('reads a rate per dozen as 12 pieces', () => {
      expect(rateBasis('₹120 per dozen')).toEqual({ per: 12, unit: null });
      expect(rateBasis('₹120/दर्जन')).toEqual({ per: 12, unit: null });
      expect(quantityInRateUnits('48 pcs', undefined, rateBasis('per doz.'))).toBe(4);
      expect(quantityInRateUnits('4 dozen', undefined, rateBasis('per dozen'))).toBe(4);
      expect(quantityInRateUnits('2 dozen', undefined, rateBasis('per kg'))).toBeNull();
    });
  });

  describe('weightKg', () => {
    it('converts tonnes and quintals to kg', () => {
      expect(weightKg('24.86 MT')).toBe(24860);
      expect(weightKg('32 Qtl')).toBe(3200);
      expect(weightKg('40 क्विंटल')).toBe(4000);
      expect(weightKg('9,340 kg')).toBe(9340);
      expect(weightKg('9340')).toBe(9340);
      expect(weightKg('n/a')).toBeNull();
    });
    it('knows Hindi units, grams and Devanagari digits', () => {
      expect(weightKg('24.86 टन')).toBe(24860);
      expect(weightKg('3.2 M.T.')).toBe(3200);
      expect(weightKg('62.5 (Qtl)')).toBe(6250);
      expect(weightKg('500 g')).toBe(0.5);
      expect(weightKg('750 ग्राम')).toBe(0.75);
      expect(weightKg('१८६ किलो')).toBe(186);
    });
    it('adds up a weight written in two units', () => {
      expect(weightKg('18 qtl 60 kg')).toBe(1860);
      expect(weightKg('18 क्विंटल 60 किलो')).toBe(1860);
      expect(weightKg('3 MT + 200 kg')).toBe(3200);
      expect(weightKg('2 kg 500 g')).toBe(2.5);
    });
    it('does not add a second weight that is not part of the first', () => {
      expect(weightKg('24.86 MT (24860 kg)')).toBe(24860);
      expect(weightKg('60 kg 18 qtl')).toBe(60);
      expect(weightKg('18 qtl, 40 bags')).toBe(1800);
    });
    it('counts a number without a unit as the given kg each, or gives null', () => {
      expect(weightKg('18.6', 100)).toBe(1860);
      expect(weightKg('18.6', null)).toBeNull();
      expect(weightKg('18.6 qtl', null)).toBe(1860);
    });
  });

  describe('parseIndianDate', () => {
    const ymd = (text: string, options?: { monthOnly?: boolean }) => {
      const date = parseIndianDate(text, options);
      return date && [date.y, date.m, date.d, date.monthOnly];
    };
    it('reads day-first and ISO dates', () => {
      expect(ymd('18-10-2026')).toEqual([2026, 10, 18, false]);
      expect(ymd('18/10/26')).toEqual([2026, 10, 18, false]);
      expect(ymd('18.10.2026')).toEqual([2026, 10, 18, false]);
      expect(ymd('18 Oct 2026')).toEqual([2026, 10, 18, false]);
      expect(ymd('14-April-2027')).toEqual([2027, 4, 14, false]);
      expect(ymd('2026-10-18')).toEqual([2026, 10, 18, false]);
      expect(parseIndianDate('18-10-2026')?.time).toBe(Date.UTC(2026, 9, 18));
    });
    it('reads dates written in Devanagari digits', () => {
      expect(ymd('१५-१०-२०२६')).toEqual([2026, 10, 15, false]);
      expect(ymd('०८/२८', { monthOnly: true })).toEqual([2028, 8, 31, true]);
    });
    it('ignores a printed time after the date', () => {
      expect(ymd('08-10-2026 11:42')).toEqual([2026, 10, 8, false]);
      expect(ymd('18-10-2026 10:30 AM')).toEqual([2026, 10, 18, false]);
      expect(ymd('2026-10-18T10:30')).toEqual([2026, 10, 18, false]);
    });
    it('rejects days that do not exist and unreadable text', () => {
      expect(parseIndianDate('31-02-2026')).toBeNull();
      expect(parseIndianDate('31-04-2026')).toBeNull();
      expect(parseIndianDate('28-13-2026')).toBeNull();
      expect(parseIndianDate('28-Xyz-2026')).toBeNull();
      expect(parseIndianDate('18-10-202')).toBeNull();
      expect(parseIndianDate('Diwali')).toBeNull();
      expect(parseIndianDate(undefined)).toBeNull();
      expect(ymd('29-02-2028')).toEqual([2028, 2, 29, false]);
    });
    it('reads month-only expiries first when asked, as the last day of the month', () => {
      expect(ymd('03/12 - 10 × ₹10', { monthOnly: true })).toEqual([2012, 3, 31, true]);
      expect(ymd('Aug 2028', { monthOnly: true })).toEqual([2028, 8, 31, true]);
      expect(ymd('02/28', { monthOnly: true })).toEqual([2028, 2, 29, true]);
      expect(ymd('12/10/2027', { monthOnly: true })).toEqual([2027, 10, 12, false]);
      expect(ymd('Oct 2026')).toBeNull();
    });
  });
});
