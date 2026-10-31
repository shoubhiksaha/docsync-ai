import type { RecordField } from '@/modules/profiles';
import {
  isAadhaarField,
  isGstin,
  isMobileNumber,
  isVehicleNumber,
  maskAadhaar,
  maskAadhaarInText,
  moneyClose,
  rupees,
} from '@/modules/profiles/checks';

const f = (key: string, value: string, label = key): RecordField => ({ key, label, value });

describe('profiles/checks', () => {
  describe('rupees', () => {
    it('formats with Indian grouping and at most 2 decimals', () => {
      expect(rupees(150000)).toBe('₹1,50,000');
      expect(rupees(1234.5)).toBe('₹1,234.5');
      expect(rupees(12.345)).toBe('₹12.35');
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
  });
});
