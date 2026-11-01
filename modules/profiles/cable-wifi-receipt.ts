import { parseNumber, toAsciiDigits } from '@/core/text';
import { amountValue, rupees } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const AMOUNT = ['amount', 'monthlyAmount', 'planAmount', 'subscriptionAmount', 'packAmount'];
const LATE_FEE = ['lateFee', 'lateFine', 'lateCharges', 'penalty'];
const TOTAL = ['totalPaid', 'totalAmount', 'total', 'amountPaid', 'amountReceived'];
const BILLING_MONTH = ['billingMonth', 'billingPeriod', 'month', 'period', 'forMonth'];
const CUSTOMER_ID = ['customerId', 'subscriberId', 'stbNumber', 'vcNumber', 'stbVcNumber', 'accountNumber'];
const MONTHS_PAID = ['monthsPaid', 'months', 'noOfMonths', 'numberOfMonths'];
/** "₹350 × 2 months", "350 x 3 mahine" in the amount. */
const TIMES_MONTHS = /[x×*]\s*(\d+)\s*(?:months?|mths?|mahine|महीने|माह)/i;
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Hindi month names, without the nukta (फ़रवरी → फरवरी), with their common spellings. */
const HINDI_MONTHS = [['जनवरी'], ['फरवरी'], ['मार्च'], ['अप्रैल'], ['मई'], ['जून'], ['जुलाई'], ['अगस्त'], ['सितंबर', 'सितम्बर'], ['अक्टूबर', 'अक्तूबर'], ['नवंबर', 'नवम्बर'], ['दिसंबर', 'दिसम्बर']];
/** Joins the two ends of a month range: "Sep–Oct", "Sep to Nov", "सितंबर से नवंबर". */
const RANGE = /[-–—]|\bto\b|\btill\b|\bse\b|से/i;
/** A payment never covers more months than this, so a bigger "months" is a misread. */
const MAX_MONTHS = 24;

/** The month a word names, 0-11 ("Sep", "Sept", "सितंबर"), or -1. */
function monthIndex(word: string): number {
  const w = word.toLowerCase().normalize('NFC').replace(/\u093C/g, '');
  const english = w.length >= 3 ? MONTH_NAMES.findIndex(m => m.startsWith(w)) : -1;
  return english >= 0 ? english : HINDI_MONTHS.findIndex(names => names.includes(w));
}

/**
 * How many months the payment covers: a Months Paid field, "× 2 months" in the amount, or a range
 * in the billing month ("Sep–Oct 2026" → 2, "Sep to Nov" → 3, "Sep, Oct" → 2); else 1. `stated`
 * is false when only the billing month shows it, as the amount may then already be for all of them.
 */
function monthsPaid(fields: RecordField[]): { months: number; stated: boolean } {
  const written = parseNumber(fieldValue(fields, MONTHS_PAID)) ?? parseNumber(fieldValue(fields, AMOUNT)?.match(TIMES_MONTHS)?.[1]);
  if (written !== null && Number.isInteger(written) && written >= 1 && written <= MAX_MONTHS) return { months: written, stated: true };
  const period = toAsciiDigits(fieldValue(fields, BILLING_MONTH) ?? '');
  const named = [...period.matchAll(/[a-z]+|[ऀ-ॿ]+/gi)]
    .map(m => ({ month: monthIndex(m[0]), at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
    .filter(m => m.month >= 0);
  if (named.length === 2 && RANGE.test(period.slice(named[0].end, named[1].at))) {
    return { months: ((named[1].month - named[0].month + 12) % 12) + 1, stated: false };
  }
  return { months: Math.max(1, new Set(named.map(m => m.month)).size), stated: false };
}

export const cableWifiReceipt: DocumentProfile = {
  id: 'cable-wifi-receipt',
  title: 'Cable TV / WiFi Collection Receipts',
  documentName: 'Cable TV / WiFi Receipt',
  description: 'Keep a record of monthly cable and Wi-Fi payments collected door to door.',
  group: 'community',
  sheetTab: 'Cable_WiFi_Receipts',
  sheetTitle: 'DocSync — Cable TV / WiFi Receipts',
  sampleDocument: { href: '/samples/cable-wifi-receipt.jpg', fileName: 'Sample_Cable_WiFi_Receipt.jpg' },
  duplicateKey: 'receiptNumber',
  translations: {
    hi: {
      title: 'केबल टीवी / वाई-फ़ाई वसूली रसीदें',
      documentName: 'केबल टीवी / वाई-फ़ाई रसीद',
      description: 'घर-घर जाकर लिए गए केबल और वाई-फ़ाई के मासिक भुगतान पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian local cable TV or broadband (WiFi) operator\'s monthly collection receipt, usually a small printed receipt book filled in by hand by the collector at the customer\'s door, with labels like "रसीद नं.", "नाम", "माह", "राशि", "लेट फीस" and "कुल". Record the subscriber\'s customer ID or set-top box (STB) / VC number exactly as written, the area or ward, the plan or pack, the billing month or period the payment covers, the monthly amount, the number of months paid when it covers more than one (Months Paid), any late fee, the total paid, payment mode (cash/UPI) and the collector\'s name.',
    priorityFields: ['Receipt Number', 'Date', 'Subscriber Name', 'Customer ID / STB No.', 'Billing Month', 'Amount', 'Late Fee', 'Total Paid', 'Collector'],
  },
  mockFields: [
    { key: 'receiptNumber', label: 'Receipt Number', value: '4417', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '12-10-2026', confidence: 94, category: 'date' },
    { key: 'subscriberName', label: 'Subscriber Name', value: 'Kamla Devi', confidence: 91, category: 'identity' },
    { key: 'customerId', label: 'Customer ID / STB No.', value: 'STB 3009877231', confidence: 82, category: 'identity' },
    { key: 'area', label: 'Area', value: 'Ward 7, Rampur Road', confidence: 86, category: 'contact' },
    { key: 'plan', label: 'Plan / Pack', value: 'Value Pack (Cable TV)', confidence: 80, category: 'other' },
    { key: 'billingMonth', label: 'Billing Month', value: 'October 2026', confidence: 90, category: 'date' },
    { key: 'amount', label: 'Amount', value: '₹350', confidence: 96, category: 'financial' },
    { key: 'lateFee', label: 'Late Fee', value: '₹20', confidence: 88, category: 'financial' },
    { key: 'totalPaid', label: 'Total Paid', value: '₹370', confidence: 95, category: 'financial' },
    { key: 'paymentMode', label: 'Payment Mode', value: 'Cash', confidence: 87, category: 'financial' },
    { key: 'collector', label: 'Collector', value: 'Raju', confidence: 78, category: 'metadata' },
  ],
  notion: {
    titleFrom: ['subscriberName', 'subscriber', 'customerName', 'name'],
    dateFrom: ['date', 'receiptDate', 'paymentDate'],
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL },
      { name: 'Subscriber ID', type: 'rich_text', from: CUSTOMER_ID },
      { name: 'Billing Month', type: 'rich_text', from: BILLING_MONTH },
    ],
  },
  derive(fields) {
    if (findField(fields, TOTAL)) return fields;
    const amount = amountValue(fieldValue(fields, AMOUNT));
    if (amount === null) return fields;
    const lateFee = amountValue(fieldValue(fields, LATE_FEE)) ?? 0;
    const { months, stated } = monthsPaid(fields);
    const total = amount * (stated ? months : 1) + lateFee;
    return [...fields, { key: 'totalPaid', label: 'Total Paid', value: String(total), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const amount = amountValue(fieldValue(fields, AMOUNT));
    const lateFee = amountValue(fieldValue(fields, LATE_FEE)) ?? 0;
    const total = amountValue(fieldValue(fields, TOTAL));
    if (amount !== null && total !== null) {
      const { months, stated } = monthsPaid(fields);
      const expected = amount * months + lateFee;
      const off = (sum: number) => Math.abs(sum - total) > Math.max(1, sum * 0.01);
      // A range only in the billing month ("Sep–Oct") may already be priced into the amount.
      if (off(expected) && (stated || months === 1 || off(amount + lateFee))) {
        const params = { total: rupees(total), amount: rupees(amount), lateFee: rupees(lateFee), expected: rupees(expected) };
        warnings.push(months === 1
          ? { code: 'cable.total', field: fieldKey(fields, TOTAL), params }
          : { code: 'cable.totalMonths', field: fieldKey(fields, TOTAL), params: { ...params, months } });
      }
    }
    if (!fieldValue(fields, BILLING_MONTH)) {
      warnings.push({ code: 'cable.noMonth' });
    }
    return warnings;
  },
};
