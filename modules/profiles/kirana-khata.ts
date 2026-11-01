import { parseNumber } from '@/core/text';
import { isMobileNumber, parseIndianDate, rupees, signedAmount } from './checks';
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
    const opening = signedAmount(fieldValue(fields, OPENING)) ?? 0;
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
    // A customer who paid ahead has a negative balance ("-₹200", "₹200 advance", "200 Cr").
    const balance = signedAmount(fieldValue(fields, BALANCE));
    if (credit !== null && paid !== null && balance !== null) {
      const opening = signedAmount(fieldValue(fields, OPENING)) ?? 0;
      const expected = opening + credit - paid;
      if (Math.abs(balance - expected) > 1) {
        warnings.push(`Balance due (${rupees(balance)}) doesn't equal opening ${rupees(opening)} + credit ${rupees(credit)} − paid ${rupees(paid)} = ${rupees(expected)}. Check the totals.`);
      }
    }

    const fromRaw = fieldValue(fields, FROM);
    const toRaw = fieldValue(fields, TO);
    const from = parseIndianDate(fromRaw)?.time ?? null;
    const to = parseIndianDate(toRaw)?.time ?? null;
    if (from !== null && to !== null && from > to) {
      warnings.push(`From date (${fromRaw}) is after the last entry date (${toRaw}). Check the dates.`);
    }
    return warnings;
  },
};
