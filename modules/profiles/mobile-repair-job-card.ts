import { amountValue, derivedRupees, isMobileNumber, parseIndianDate, rupees, signedAmount } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RuleWarning } from './types';

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
  description: 'Turn each repair job card into one row: problem, IMEI, part used, total, advance and delivery date.',
  group: 'shops',
  sheetTab: 'Mobile_Repair_Jobs',
  sheetTitle: 'DocSync — Mobile Repair Job Cards',
  sampleDocument: { href: '/samples/mobile-repair-job-card.jpg', fileName: 'Sample_Mobile_Repair_Job_Card.jpg' },
  duplicateKey: 'jobCardNumber',
  translations: {
    hi: {
      title: 'मोबाइल मरम्मत जॉब कार्ड',
      documentName: 'मोबाइल रिपेयर जॉब कार्ड',
      description: 'हर जॉब कार्ड से ग्राहक की समस्या, IMEI, लगा पुर्ज़ा, कुल ख़र्च, एडवांस और डिलीवरी की तारीख पढ़कर शीट में जोड़ें।',
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
    const total = amountValue(fieldValue(fields, TOTAL));
    const advance = amountValue(fieldValue(fields, ADVANCE));
    if (total === null || advance === null) return fields;
    return [...fields, { key: 'balance', label: 'Balance', value: derivedRupees(total - advance), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];

    // Dual-SIM phones have two IMEIs, often written as "IMEI1 / IMEI2" or "IMEI 1: … IMEI 2: …";
    // the "IMEI 1" label also separates them, and its 1 is not part of the number.
    const imei = fieldValue(fields, IMEI);
    const imeiKey = fieldKey(fields, IMEI);
    for (const part of imei ? imei.replace(/imei\s*-?\s*(?:[12](?!\d))?\s*[:#.=-]?/gi, '|').split(/[/,;|]|\s{2,}/) : []) {
      // Digits grouped with spaces or hyphens ("35 291711 482736 2") are one number.
      const runs = part.replace(/(\d)[\s-]+(?=\d)/g, '$1').match(/\d+/g) ?? [];
      const long = runs.filter(run => run.length >= 14);
      for (const digits of long.length ? long : [runs.join('')].filter(Boolean)) {
        if (digits.length !== 15) {
          warnings.push({ code: 'mobile.imeiLength', field: imeiKey, params: { imei: part.trim(), digits: digits.length } });
        } else if (!luhnValid(digits)) {
          warnings.push({ code: 'mobile.imeiCheck', field: imeiKey, params: { imei: digits } });
        }
      }
    }

    const total = amountValue(fieldValue(fields, TOTAL));
    const advance = amountValue(fieldValue(fields, ADVANCE));
    // Paid ahead is a negative balance ("-₹200", "₹200 advance").
    const balance = signedAmount(fieldValue(fields, BALANCE));
    if (total !== null && advance !== null) {
      if (advance > total) {
        warnings.push({ code: 'advanceOver', field: fieldKey(fields, ADVANCE), params: { advance: rupees(advance), total: rupees(total) } });
      } else if (balance !== null && Math.abs(total - advance - balance) > 1) {
        warnings.push({
          code: 'balance',
          field: fieldKey(fields, BALANCE),
          params: { balance: rupees(balance), total: rupees(total), advance: rupees(advance), expected: rupees(total - advance) },
        });
      }
    }

    const jobRaw = fieldValue(fields, JOB_DATE);
    const deliveryRaw = fieldValue(fields, DELIVERY);
    const job = parseIndianDate(jobRaw)?.time ?? null;
    const delivery = parseIndianDate(deliveryRaw)?.time ?? null;
    if (job !== null && delivery !== null && delivery < job) {
      warnings.push({ code: 'mobile.dates', field: fieldKey(fields, DELIVERY), params: { delivery: deliveryRaw ?? '', job: jobRaw ?? '' } });
    }

    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push({ code: 'phone', field: fieldKey(fields, PHONE), params: { phone } });
    }
    return warnings;
  },
};
