import { parseNumber } from '@/core/text';
import { isMobileNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const PHONE = ['phone', 'phoneNumber', 'mobile', 'mobileNumber', 'contactNumber'];
const LOAN = ['loanAmount', 'chitAmount', 'chitValue', 'principal', 'amountGiven'];
const REPAYABLE = ['totalRepayable', 'amountRepayable', 'repayableAmount', 'totalPayable'];
const INSTALMENT = ['dailyInstalment', 'dailyInstallment', 'dailyKist', 'instalment', 'installment', 'kist'];
const PAID_TODAY = ['amountPaidToday', 'paidToday', 'todayPayment', 'amountPaid'];
const TOTAL_PAID = ['totalPaid', 'totalPaidSoFar', 'totalCollected', 'kulJama'];
const BALANCE = ['balance', 'balanceOutstanding', 'outstanding', 'baki'];
const DAYS_PAID = ['daysPaid', 'days', 'daysCompleted'];
const TOTAL_DAYS = ['totalDays', 'tenureDays', 'duration'];
const SCHEME = ['scheme', 'schemeName', 'loanScheme', 'plan'];

/** "62 / 100" or "62 of 100" in the days-paid field also carries the total days. */
function totalDaysFrom(daysPaid: string | undefined): number | null {
  const match = daysPaid?.match(/\d+\s*(?:\/|of)\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** The loan's length in days: Total Days, "62 / 100" in Days Paid, or the scheme ("Daily loan (100 days)", "100 din", "100 दिन"). */
function tenureDays(fields: RecordField[]): number | null {
  const scheme = fieldValue(fields, SCHEME)?.match(/(\d+)\s*-?\s*(?:days?|din|दिन)/i);
  return parseNumber(fieldValue(fields, TOTAL_DAYS)) ?? totalDaysFrom(fieldValue(fields, DAYS_PAID)) ?? (scheme ? Number(scheme[1]) : null);
}

/**
 * What the card says is to be repaid in all, and how that was worked out. Daily loans are usually
 * repaid with interest (₹10,000 lent, ₹120 a day for 100 days = ₹12,000), so a printed total
 * repayable comes first, then daily instalment × total days, and the loan amount only when neither
 * is known (or instalment × days is less than the loan, which would be a misread). With a daily
 * instalment but no total days, the loan amount may leave out the interest: `tenureUnknown` is set.
 */
function repayable(fields: RecordField[]): { amount: number; fromLoan: boolean; how?: string; tenureUnknown?: boolean } | null {
  const stated = parseNumber(fieldValue(fields, REPAYABLE));
  if (stated !== null) return { amount: stated, fromLoan: false };
  const loan = parseNumber(fieldValue(fields, LOAN));
  const instalment = parseNumber(fieldValue(fields, INSTALMENT));
  const totalDays = tenureDays(fields);
  if (instalment !== null && totalDays !== null && instalment * totalDays >= (loan ?? 0)) {
    return { amount: instalment * totalDays, fromLoan: false, how: `${rupees(instalment)} a day × ${totalDays} days` };
  }
  return loan === null ? null : { amount: loan, fromLoan: true, tenureUnknown: instalment !== null && totalDays === null };
}

export const streetVendorDailyFinance: DocumentProfile = {
  id: 'street-vendor-daily-finance',
  title: 'Street Vendor Daily Finance',
  documentName: 'Daily Collection Card',
  description: 'Keep a record of daily micro-loan collections (bishi / chit fund payments).',
  group: 'community',
  sheetTab: 'Daily_Collections',
  sheetTitle: 'DocSync — Street Vendor Daily Finance',
  sampleDocument: { href: '/samples/street-vendor-daily-finance.jpg', fileName: 'Sample_Daily_Collection_Card.jpg' },
  translations: {
    hi: {
      title: 'रेहड़ी-पटरी दैनिक वित्त',
      documentName: 'रोज़ की किस्त का कार्ड',
      description: 'रोज़ की माइक्रो-लोन वसूली (बिशी/चिट फ़ंड) पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian daily collection card or register page for a small daily-repayment loan, bishi or chit fund, kept by a street vendor or the collector, often a printed card with a grid of dated boxes filled in by hand, with labels like "कार्ड नं.", "नाम", "लोन राशि", "रोज़ की किस्त", "जमा", "कुल जमा" and "बाकी". Record one row per scan: card/account number, member name, phone, scheme (daily loan, bishi or chit), loan or chit amount, total repayable (loan plus interest) if written, daily instalment, the date and amount of the latest (today\'s) entry, total paid so far, balance outstanding, days paid out of total days (e.g. "62 / 100"; write the total days separately if the card only says it in the scheme) and the collector. Do not list every daily box; count them into Days Paid and add them into Total Paid only if the card has no running total.',
    priorityFields: ['Card Number', 'Member Name', 'Scheme', 'Loan Amount', 'Daily Instalment', 'Date', 'Amount Paid Today', 'Total Paid', 'Balance', 'Days Paid'],
  },
  mockFields: [
    { key: 'cardNumber', label: 'Card Number', value: 'DL-0291', confidence: 91, category: 'identity' },
    { key: 'memberName', label: 'Member Name', value: 'Mohd. Salim', confidence: 90, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 43310', confidence: 86, category: 'contact' },
    { key: 'scheme', label: 'Scheme', value: 'Daily loan (100 days)', confidence: 84, category: 'metadata' },
    { key: 'loanAmount', label: 'Loan Amount', value: '₹10,000', confidence: 95, category: 'financial' },
    { key: 'dailyInstalment', label: 'Daily Instalment', value: '₹100', confidence: 94, category: 'financial' },
    { key: 'date', label: 'Date', value: '29-10-2026', confidence: 92, category: 'date' },
    { key: 'amountPaidToday', label: 'Amount Paid Today', value: '₹100', confidence: 93, category: 'financial' },
    { key: 'totalPaid', label: 'Total Paid', value: '₹6,200', confidence: 89, category: 'financial' },
    { key: 'balance', label: 'Balance', value: '₹3,800', confidence: 90, category: 'financial' },
    { key: 'daysPaid', label: 'Days Paid', value: '62 / 100', confidence: 85, category: 'other' },
    { key: 'collector', label: 'Collector', value: 'Vinod', confidence: 78, category: 'metadata' },
  ],
  notion: {
    titleFrom: ['memberName', 'vendorName', 'borrowerName', 'name'],
    dateFrom: ['date', 'collectionDate', 'paymentDate'],
    properties: [
      { name: 'Amount', type: 'number', from: PAID_TODAY },
      { name: 'Loan Balance', type: 'number', from: BALANCE },
      { name: 'Phone', type: 'rich_text', from: PHONE },
    ],
  },
  derive(fields) {
    if (findField(fields, BALANCE)) return fields;
    const due = repayable(fields);
    const totalPaid = parseNumber(fieldValue(fields, TOTAL_PAID));
    if (due === null || due.tenureUnknown || totalPaid === null) return fields;
    return [...fields, { key: 'balance', label: 'Balance', value: String(due.amount - totalPaid), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const due = repayable(fields);
    const totalPaid = parseNumber(fieldValue(fields, TOTAL_PAID));
    const balance = parseNumber(fieldValue(fields, BALANCE));
    if (due !== null && totalPaid !== null && balance !== null && Math.abs(due.amount - totalPaid - balance) > 1) {
      const sum = `${rupees(due.amount)} − ${rupees(totalPaid)} = ${rupees(due.amount - totalPaid)}`;
      warnings.push(due.tenureUnknown
        ? `Can't tell the total repayable, so the balance (${rupees(balance)}) can't be checked: the card has a daily instalment but no total days. Add Total Days (e.g. 100) if the loan carries interest.`
        : due.fromLoan
        ? `Balance (${rupees(balance)}) doesn't equal loan amount − total paid (${sum}). Please check the card.`
        : `Balance (${rupees(balance)}) doesn't equal amount repayable − total paid (${sum}${due.how ? `; repayable is ${due.how}` : ''}). Please check the card.`);
    }

    const instalment = parseNumber(fieldValue(fields, INSTALMENT));
    const paidToday = parseNumber(fieldValue(fields, PAID_TODAY));
    if (instalment !== null && paidToday !== null && paidToday < instalment) {
      warnings.push(`Short payment: ${rupees(paidToday)} paid today against a daily instalment of ${rupees(instalment)} (${rupees(instalment - paidToday)} short).`);
    }

    const daysPaid = parseNumber(fieldValue(fields, DAYS_PAID));
    const totalDays = tenureDays(fields);
    if (daysPaid !== null && totalDays !== null && daysPaid > totalDays) {
      warnings.push(`Days paid (${daysPaid}) is more than the total days (${totalDays}). Please check the count.`);
    }

    const phone = fieldValue(fields, PHONE)?.replace(/[\s-]/g, '');
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }
    return warnings;
  },
};
