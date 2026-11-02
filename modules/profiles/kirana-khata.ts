import { parseNumber } from '@/core/text';
import { amountValue, derivedRupees, idDate, isMobileNumber, parseIndianDate, rupees, signedAmount } from './checks';
import { fieldKey, fieldValue, findField, withSlipId } from './fields';
import type { DocumentProfile, RuleWarning } from './types';

const CUSTOMER = ['customerName', 'customer', 'name', 'partyName'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'mobileNo'];
const OPENING = ['openingBalance', 'previousBalance', 'balanceBroughtForward', 'pichlaBaki'];
const CREDIT = ['totalCredit', 'totalUdhaar', 'udhaar', 'creditTotal'];
const PAID = ['totalPaid', 'totalJama', 'jama', 'paidTotal'];
const BALANCE = ['balanceDue', 'balance', 'baki', 'outstanding', 'closingBalance'];
const FROM = ['fromDate', 'startDate', 'firstEntryDate'];
const TO = ['toDate', 'endDate', 'lastEntryDate', 'date'];
const ENTRIES = ['entries', 'lineEntries', 'transactions'];

/** An amount in an entry, "₹640", "Rs. 640" or "640". */
const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)`;

/** How an entry marks its amount: the word, then the amount after it ("udhaar ₹640") or before it ("₹640 udhaar"). */
function marking(word: string): { word: RegExp; after: RegExp; before: RegExp } {
  return {
    word: new RegExp(word, 'i'),
    after: new RegExp(String.raw`(?:${word})\s*[:\-–]?\s*${AMOUNT}`, 'i'),
    before: new RegExp(String.raw`${AMOUNT}\s*(?:\/-)?\s*(?:${word})`, 'i'),
  };
}
/** Credit given: "udhaar", "उधार", "नामे". */
const CREDIT_ENTRY = marking('udh?aa?r|उधार|नामे|naame');
/** A payment received: "jama", "जमा". */
const PAID_ENTRY = marking('jama|जमा');
/** The balance brought from the last page, written as a line of its own: it is the opening balance, not credit. */
const OPENING_ENTRY = /pichh?la\s*baa?ki|पिछला\s*बाकी|पिछली\s*बाकी|opening|b\/f|brought\s*forward/i;

/** The amount an entry marks this way; undefined when the entry doesn't use the word, null when no amount goes with it. */
function markedAmount(entry: string, mark: ReturnType<typeof marking>): number | null | undefined {
  if (!mark.word.test(entry)) return undefined;
  const match = entry.match(mark.after) ?? entry.match(mark.before);
  return match ? parseNumber(match[1]) : null;
}

/**
 * The udhaar and jama entries added up ("01-10 – Atta – udhaar ₹640; 05-10 – jama ₹500" → 640
 * and 500), leaving out a "पिछला बाकी" line. Null when any entry has no amount marked udhaar or
 * jama (or is marked both), so a line the model wrote some other way never makes the totals look wrong.
 */
function entrySums(text: string): { credit: number; paid: number } | null {
  const entries = text.split(/[;\n]+/).map(e => e.trim()).filter(e => e && !OPENING_ENTRY.test(e));
  if (!entries.length) return null;
  let credit = 0;
  let paid = 0;
  for (const entry of entries) {
    const udhaar = markedAmount(entry, CREDIT_ENTRY);
    const jama = markedAmount(entry, PAID_ENTRY);
    if ((udhaar === undefined) === (jama === undefined)) return null;
    const amount = udhaar ?? jama;
    if (amount === null || amount === undefined) return null;
    if (udhaar !== undefined) credit += amount;
    else paid += amount;
  }
  return { credit, paid };
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
  // A page has no number: the same customer up to the same last entry is the same page.
  duplicateKey: 'slipId',
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
    let out = fields;
    // On a khata "Cr" is the credit column, never crore ("₹1,540 Cr").
    const credit = amountValue(fieldValue(fields, CREDIT), { crore: false });
    const paid = amountValue(fieldValue(fields, PAID), { crore: false });
    if (!findField(fields, BALANCE) && credit !== null && paid !== null) {
      const opening = signedAmount(fieldValue(fields, OPENING)) ?? 0;
      out = [...out, { key: 'balanceDue', label: 'Balance Due', value: derivedRupees(opening + credit - paid), confidence: 100, category: 'financial' }];
    }
    return withSlipId(out, [fieldValue(fields, CUSTOMER), idDate(fieldValue(fields, TO))]);
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push({ code: 'phone', field: fieldKey(fields, PHONE), params: { phone } });
    }

    const credit = amountValue(fieldValue(fields, CREDIT), { crore: false });
    const paid = amountValue(fieldValue(fields, PAID), { crore: false });
    // A customer who paid ahead has a negative balance ("-₹200", "₹200 advance", "200 Cr").
    const balance = signedAmount(fieldValue(fields, BALANCE));
    if (credit !== null && paid !== null && balance !== null) {
      const opening = signedAmount(fieldValue(fields, OPENING)) ?? 0;
      const expected = opening + credit - paid;
      if (Math.abs(balance - expected) > 1) {
        warnings.push({
          code: 'kirana.balance',
          field: fieldKey(fields, BALANCE),
          params: { balance: rupees(balance), opening: rupees(opening), credit: rupees(credit), paid: rupees(paid), expected: rupees(expected) },
        });
      }
    }

    // A hand-added "कुल" that is wrong passes the balance check when the balance was worked out from it.
    const entries = fieldValue(fields, ENTRIES);
    const sums = entries ? entrySums(entries) : null;
    if (sums && credit !== null && Math.abs(sums.credit - credit) > 1) {
      warnings.push({ code: 'kirana.creditSum', field: fieldKey(fields, CREDIT), params: { total: rupees(credit), sum: rupees(sums.credit) } });
    }
    if (sums && paid !== null && Math.abs(sums.paid - paid) > 1) {
      warnings.push({ code: 'kirana.paidSum', field: fieldKey(fields, PAID), params: { total: rupees(paid), sum: rupees(sums.paid) } });
    }

    const fromRaw = fieldValue(fields, FROM);
    const toRaw = fieldValue(fields, TO);
    const from = parseIndianDate(fromRaw)?.time ?? null;
    const to = parseIndianDate(toRaw)?.time ?? null;
    if (from !== null && to !== null && from > to) {
      warnings.push({ code: 'kirana.dates', field: fieldKey(fields, FROM), params: { from: fromRaw ?? '', to: toRaw ?? '' } });
    }
    return warnings;
  },
};
