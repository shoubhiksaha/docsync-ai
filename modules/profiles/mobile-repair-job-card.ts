import { parseNumber } from '@/core/text';
import { isMobileNumber, parseIndianDate, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const CUSTOMER = ['customerName', 'customer', 'name'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'contactNumber'];
const IMEI = ['imei', 'imeiNumber', 'imeiNo', 'imei1'];
const TOTAL = ['totalAmount', 'total', 'estimate', 'estimatedAmount', 'repairCharges', 'amount'];
const ADVANCE = ['advance', 'advancePaid', 'advanceAmount'];
const BALANCE = ['balance', 'balanceDue', 'baki', 'balanceAmount'];
const JOB_DATE = ['date', 'jobDate', 'receivedDate'];
const DELIVERY = ['deliveryDate', 'promisedDate', 'promisedDeliveryDate', 'readyDate'];

/** Luhn check used for the 15th (check) digit of an IMEI. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export const mobileRepairJobCard: DocumentProfile = {
  id: 'mobile-repair-job-card',
  title: 'Mobile Repair Job Cards',
  documentName: 'Mobile Repair Job Card',
  description: 'Extract customer issue, IMEI, spare part used, total, advance and delivery date from repair job cards.',
  group: 'shops',
  sheetTab: 'Mobile_Repair_Jobs',
  sheetTitle: 'DocSync — Mobile Repair Job Cards',
  sampleDocument: { href: '/samples/mobile-repair-job-card.jpg', fileName: 'Sample_Mobile_Repair_Job_Card.jpg' },
  duplicateKey: 'jobCardNumber',
  translations: {
    hi: {
      title: 'मोबाइल मरम्मत जॉब कार्ड',
      documentName: 'मोबाइल रिपेयर जॉब कार्ड',
      description: 'जॉब कार्ड से ग्राहक की समस्या, IMEI, लगा पुर्ज़ा, कुल ख़र्च, एडवांस और डिलीवरी की तारीख निकालें।',
    },
  },
  extraction: {
    context: 'This is an Indian mobile phone repair shop job card (जॉब कार्ड), usually a printed carbon-copy pad filled in by hand at the counter. It shows the job card number, date, customer name and phone, phone brand and model, IMEI (15 digits, written under "IMEI No."), the problem reported (e.g. "display tuta", "charging nahi ho raha"), the spare part used, estimate or total amount, advance (एडवांस) and balance (बाकी), and the promised delivery date. Record the IMEI digits exactly as written; never record screen-lock passwords, PINs or patterns even if they are written on the card.',
    priorityFields: ['Job Card Number', 'Date', 'Customer Name', 'Phone', 'Brand Model', 'IMEI', 'Problem', 'Spare Part', 'Total Amount', 'Delivery Date'],
  },
  mockFields: [
    { key: 'jobCardNumber', label: 'Job Card Number', value: 'JC-2741', confidence: 94, category: 'identity' },
    { key: 'date', label: 'Date', value: '27-10-2026', confidence: 93, category: 'date' },
    { key: 'customerName', label: 'Customer Name', value: 'Pooja Singh', confidence: 91, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 42563', confidence: 90, category: 'contact' },
    { key: 'brandModel', label: 'Brand Model', value: 'Redmi Note 12 Pro', confidence: 92, category: 'other' },
    { key: 'imei', label: 'IMEI', value: '352917114827362', confidence: 86, category: 'identity' },
    { key: 'problem', label: 'Problem', value: 'Display broken, touch not working', confidence: 84, category: 'other' },
    { key: 'sparePart', label: 'Spare Part', value: 'Display combo (folder)', confidence: 82, category: 'other' },
    { key: 'totalAmount', label: 'Total Amount', value: '₹3,200', confidence: 95, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹1,000', confidence: 94, category: 'financial' },
    { key: 'balance', label: 'Balance', value: '₹2,200', confidence: 94, category: 'financial' },
    { key: 'deliveryDate', label: 'Delivery Date', value: '29-10-2026', confidence: 88, category: 'date' },
  ],
  notion: {
    titleFrom: CUSTOMER,
    dateFrom: JOB_DATE,
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL },
      { name: 'Phone', type: 'rich_text', from: PHONE },
      { name: 'IMEI', type: 'rich_text', from: IMEI },
    ],
  },
  derive(fields) {
    if (findField(fields, BALANCE)) return fields;
    const total = parseNumber(fieldValue(fields, TOTAL));
    const advance = parseNumber(fieldValue(fields, ADVANCE));
    if (total === null || advance === null) return fields;
    return [...fields, { key: 'balance', label: 'Balance', value: String(total - advance), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];

    // Dual-SIM phones have two IMEIs, often written as "IMEI1 / IMEI2".
    const imei = fieldValue(fields, IMEI);
    for (const part of imei ? imei.split(/[/,;|]|\s{2,}/) : []) {
      const digits = part.replace(/\D/g, '');
      if (!digits) continue;
      if (digits.length !== 15) {
        warnings.push(`IMEI "${part.trim()}" has ${digits.length} digits; an IMEI has 15. Please check it.`);
      } else if (!luhnValid(digits)) {
        warnings.push(`IMEI ${digits} fails the check-digit test, so a digit is probably misread. Check it against *#06# or the phone box.`);
      }
    }

    const total = parseNumber(fieldValue(fields, TOTAL));
    const advance = parseNumber(fieldValue(fields, ADVANCE));
    const balance = parseNumber(fieldValue(fields, BALANCE));
    if (total !== null && advance !== null) {
      if (advance > total) {
        warnings.push(`Advance (${rupees(advance)}) is more than the total (${rupees(total)}). Please check the amounts.`);
      } else if (balance !== null && Math.abs(total - advance - balance) > 1) {
        warnings.push(`Balance (${rupees(balance)}) doesn't equal total ${rupees(total)} − advance ${rupees(advance)} = ${rupees(total - advance)}.`);
      }
    }

    const jobRaw = fieldValue(fields, JOB_DATE);
    const deliveryRaw = fieldValue(fields, DELIVERY);
    const job = parseIndianDate(jobRaw)?.time ?? null;
    const delivery = parseIndianDate(deliveryRaw)?.time ?? null;
    if (job !== null && delivery !== null && delivery < job) {
      warnings.push(`Delivery date (${deliveryRaw}) is before the job date (${jobRaw}). Check the dates.`);
    }

    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }
    return warnings;
  },
};
