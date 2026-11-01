import { parseNumber } from '@/core/text';
import { amountValue, derivedRupees, idDate, isMobileNumber, rupees, signedAmount } from './checks';
import { fieldKey, fieldValue, findField, withSlipId } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

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
const CARD = ['cardNumber', 'cardNo', 'accountNumber', 'accountNo', 'loanNumber'];
const DATE = ['date', 'collectionDate', 'paymentDate'];

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
function repayable(fields: RecordField[]): { amount: number; fromLoan: boolean; daily?: { instalment: number; days: number }; tenureUnknown?: boolean } | null {
  const stated = amountValue(fieldValue(fields, REPAYABLE));
  if (stated !== null) return { amount: stated, fromLoan: false };
  const loan = amountValue(fieldValue(fields, LOAN));
  const instalment = amountValue(fieldValue(fields, INSTALMENT));
  const totalDays = tenureDays(fields);
  if (instalment !== null && totalDays !== null && instalment * totalDays >= (loan ?? 0)) {
    return { amount: instalment * totalDays, fromLoan: false, daily: { instalment, days: totalDays } };
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
  // The card is scanned again every day: one card on one day is one collection.
  duplicateKey: 'slipId',
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
    let out = fields;
    const due = repayable(fields);
    const totalPaid = amountValue(fieldValue(fields, TOTAL_PAID));
    if (!findField(fields, BALANCE) && due !== null && !due.tenureUnknown && totalPaid !== null) {
      out = [...out, { key: 'balance', label: 'Balance', value: derivedRupees(due.amount - totalPaid), confidence: 100, category: 'financial' }];
    }
    return withSlipId(out, [fieldValue(fields, CARD), idDate(fieldValue(fields, DATE))]);
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const due = repayable(fields);
    const totalPaid = amountValue(fieldValue(fields, TOTAL_PAID));
    // Paid ahead is a negative balance ("-₹200", "₹200 advance").
    const balance = signedAmount(fieldValue(fields, BALANCE));
    if (due !== null && totalPaid !== null && balance !== null && Math.abs(due.amount - totalPaid - balance) > 1) {
      const field = fieldKey(fields, BALANCE);
      const sums = { balance: rupees(balance), due: rupees(due.amount), paid: rupees(totalPaid), expected: rupees(due.amount - totalPaid) };
      warnings.push(due.tenureUnknown
        ? { code: 'vendor.tenureUnknown', field, params: { balance: rupees(balance) } }
        : due.fromLoan
        ? { code: 'vendor.balanceLoan', field, params: sums }
        : due.daily
        ? { code: 'vendor.balanceDaily', field, params: { ...sums, instalment: rupees(due.daily.instalment), days: due.daily.days } }
        : { code: 'vendor.balance', field, params: sums });
    }

    const instalment = amountValue(fieldValue(fields, INSTALMENT));
    const paidToday = amountValue(fieldValue(fields, PAID_TODAY));
    if (instalment !== null && paidToday !== null && paidToday < instalment) {
      warnings.push({
        code: 'vendor.short',
        field: fieldKey(fields, PAID_TODAY),
        params: { paid: rupees(paidToday), instalment: rupees(instalment), short: rupees(instalment - paidToday) },
      });
    }

    const daysPaid = parseNumber(fieldValue(fields, DAYS_PAID));
    const totalDays = tenureDays(fields);
    if (daysPaid !== null && totalDays !== null && daysPaid > totalDays) {
      warnings.push({ code: 'vendor.days', field: fieldKey(fields, DAYS_PAID), params: { daysPaid, totalDays } });
    }

    const phone = fieldValue(fields, PHONE)?.replace(/[\s-]/g, '');
    if (phone && !isMobileNumber(phone)) {
      warnings.push({ code: 'phone', field: fieldKey(fields, PHONE), params: { phone } });
    }
    return warnings;
  },
};
