import { parseNumber } from '@/core/text';
import { isMobileNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const CUSTOMER = ['customerName', 'customer', 'name', 'partyName'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'mobileNo'];
const OPENING = ['openingBalance', 'previousBalance', 'balanceBroughtForward', 'pichlaBaki'];
const CREDIT = ['totalCredit', 'totalUdhaar', 'udhaar', 'creditTotal'];
const PAID = ['totalPaid', 'totalJama', 'jama', 'paidTotal'];
const BALANCE = ['balanceDue', 'balance', 'baki', 'outstanding', 'closingBalance'];
const FROM = ['fromDate', 'startDate', 'firstEntryDate'];
const TO = ['toDate', 'endDate', 'lastEntryDate', 'date'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Day-first dates ("18-10-2026", "18/10/26", "18 Oct 2026") or ISO "2026-10-18" → UTC ms; null when unreadable. */
function dateMs(value: string | undefined): number | null {
  const v = (value ?? '').trim().toLowerCase();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = v.match(/^(\d{1,2})[-/. ]+(\d{1,2}|[a-z]{3,9})[-/., ]+(\d{4}|\d{2})$/);
  let day: number, month: number, year: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    day = Number(dmy[1]);
    month = /^\d/.test(dmy[2]) ? Number(dmy[2]) : MONTHS.indexOf(dmy[2].slice(0, 3)) + 1;
    year = Number(dmy[3]) + (dmy[3].length === 2 ? 2000 : 0);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : null;
}

export const kiranaKhata: DocumentProfile = {
  id: 'kirana-khata',
  title: 'Kirana Store Khatas',
  documentName: 'Kirana Khata Page',
  description: "Turn a customer's handwritten udhaar khata page into one row: entries, credit, payments and balance due.",
  group: 'shops',
  sheetTab: 'Kirana_Khata',
  sheetTitle: 'DocSync — Kirana Store Khatas',
  sampleDocument: { href: '/samples/kirana-khata.jpg', fileName: 'Sample_Kirana_Khata.jpg' },
  translations: {
    hi: {
      title: 'किराना दुकान खाते',
      documentName: 'किराना खाते का पन्ना',
      description: 'हाथ से लिखे उधार खाते के पन्ने से ग्राहक, उधार, जमा और बाकी रकम निकालें।',
    },
  },
  extraction: {
    context: 'This is one customer\'s page from an Indian kirana (grocery) store khata, a handwritten udhaar ledger, often with Hindi labels such as "नाम" (name), "उधार"/"नामे" (credit given), "जमा" (payment received), "पिछला बाकी" (opening balance) and "बाकी" (balance). Record the customer name, phone, the first and last entry dates, opening balance, total credit, total paid and balance due. Put every line entry into one "Entries" field, compactly as "date – items – udhaar ₹X" or "date – jama ₹Y", separated by semicolons.',
    priorityFields: ['Customer Name', 'Phone', 'From Date', 'To Date', 'Opening Balance', 'Entries', 'Total Credit', 'Total Paid', 'Balance Due'],
  },
  mockFields: [
    { key: 'shopName', label: 'Shop Name', value: 'Sharma Kirana Store', confidence: 90, category: 'metadata' },
    { key: 'customerName', label: 'Customer Name', value: 'Ramesh Yadav', confidence: 94, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 41207', confidence: 88, category: 'contact' },
    { key: 'fromDate', label: 'From Date', value: '01-10-2026', confidence: 90, category: 'date' },
    { key: 'toDate', label: 'To Date', value: '24-10-2026', confidence: 90, category: 'date' },
    { key: 'openingBalance', label: 'Opening Balance', value: '₹350', confidence: 85, category: 'financial' },
    {
      key: 'entries',
      label: 'Entries',
      value: '01-10 – Atta 10 kg, Arhar dal 2 kg – udhaar ₹640; 05-10 – jama ₹500; 09-10 – Mustard oil 1 L, Sugar 2 kg – udhaar ₹265; 14-10 – Rice 5 kg, Tea 250 g – udhaar ₹480; 20-10 – jama ₹800; 24-10 – Soap, Biscuits – udhaar ₹155',
      confidence: 78,
      category: 'other',
    },
    { key: 'totalCredit', label: 'Total Credit', value: '₹1,540', confidence: 92, category: 'financial' },
    { key: 'totalPaid', label: 'Total Paid', value: '₹1,300', confidence: 92, category: 'financial' },
    { key: 'balanceDue', label: 'Balance Due', value: '₹590', confidence: 95, category: 'financial' },
  ],
  notion: {
    titleFrom: CUSTOMER,
    dateFrom: ['toDate', 'lastEntryDate', 'date', 'fromDate'],
    properties: [
      { name: 'Amount', type: 'number', from: BALANCE },
      { name: 'Party', type: 'rich_text', from: CUSTOMER },
      { name: 'Phone', type: 'rich_text', from: PHONE },
    ],
  },
  derive(fields) {
    if (findField(fields, BALANCE)) return fields;
    const credit = parseNumber(fieldValue(fields, CREDIT));
    const paid = parseNumber(fieldValue(fields, PAID));
    if (credit === null || paid === null) return fields;
    const opening = parseNumber(fieldValue(fields, OPENING)) ?? 0;
    return [...fields, { key: 'balanceDue', label: 'Balance Due', value: String(opening + credit - paid), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }

    const credit = parseNumber(fieldValue(fields, CREDIT));
    const paid = parseNumber(fieldValue(fields, PAID));
    const balance = parseNumber(fieldValue(fields, BALANCE));
    if (credit !== null && paid !== null && balance !== null) {
      const opening = parseNumber(fieldValue(fields, OPENING)) ?? 0;
      const expected = opening + credit - paid;
      if (Math.abs(balance - expected) > 1) {
        warnings.push(`Balance due (${rupees(balance)}) doesn't equal opening ${rupees(opening)} + credit ${rupees(credit)} − paid ${rupees(paid)} = ${rupees(expected)}. Check the totals.`);
      }
    }

    const fromRaw = fieldValue(fields, FROM);
    const toRaw = fieldValue(fields, TO);
    const from = dateMs(fromRaw);
    const to = dateMs(toRaw);
    if (from !== null && to !== null && from > to) {
      warnings.push(`From date (${fromRaw}) is after the last entry date (${toRaw}). Check the dates.`);
    }
    return warnings;
  },
};
