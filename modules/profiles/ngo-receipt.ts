import { parseNumber } from '@/core/text';
import { isAadhaarField, rupees } from './checks';
import { fieldValue } from './fields';
import type { DocumentProfile } from './types';

const AMOUNT = ['amount', 'donationAmount', 'totalAmount', 'amountReceived'];
const PAN = ['panNumber', 'pan', 'donorPan', 'panNo', 'donorPanGovtId', 'panGovtId', 'donorId', 'govtId'];
const PAYMENT_MODE = ['paymentMode', 'modeOfPayment', 'paymentMethod', 'paidBy', 'mode'];
/** A PAN anywhere in the value, so "PAN: ABCDE1234F" is read too. */
const PAN_IN_TEXT = /[A-Z]{5}[0-9]{4}[A-Z]/;
/** An Aadhaar written in the PAN / Govt. ID field ("Aadhaar XXXX XXXX 1234"). */
const AADHAAR_ID = /aa?dh?aa?r|आधार|uid|x{4}|\d{4}\s?\d{4}\s?\d{4}/i;
const CASH = /cash|नकद|नक़द|नगद/i;
/** Cash donations above this get no 80G deduction (Income-tax Act s.80G(5D)). */
const CASH_LIMIT = 2000;

export const ngoReceipt: DocumentProfile = {
  id: 'ngo-receipt',
  title: 'NGO Donation Receipts',
  documentName: 'NGO Donation Receipt',
  description: 'Turn each handwritten trust receipt into one row: donor, amount, PAN and date.',
  group: 'community',
  sheetTab: 'NGO_Receipts',
  sheetTitle: 'DocSync — NGO Receipts',
  sampleDocument: { href: '/samples/ngo-receipt.jpg', fileName: 'Sample_NGO_Receipt.jpg' },
  duplicateKey: 'receiptNumber',
  translations: {
    hi: {
      title: 'NGO दान रसीदें',
      documentName: 'NGO दान रसीद',
      description: 'हाथ से लिखी हर ट्रस्ट रसीद से दानदाता का नाम, राशि, PAN और तारीख पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian NGO donation receipt. Typical fields: receipt number, date, donor name, donor address, amount, payment mode (cash, cheque or online), donor PAN or other government ID, NGO name and 80G registration reference. If the donor ID is an Aadhaar number, record only its last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['Date', 'Donor Name', 'Amount', 'PAN Number', 'Receipt Number'],
  },
  // The values on public/samples/ngo-receipt.jpg, so "Try a sample" without an AI key shows what's on it.
  mockFields: [
    { key: 'date', label: 'Date', value: '15/07/2026', confidence: 95, category: 'date' },
    { key: 'receiptNumber', label: 'Receipt Number', value: 'HHF/26-27/0458', confidence: 88, category: 'identity' },
    { key: 'donorName', label: 'Donor Name', value: 'Arjun Mehta', confidence: 97, category: 'identity' },
    { key: 'donorAddress', label: 'Donor Address', value: 'Flat 402, Shivam Apts, Pune-411038', confidence: 86, category: 'contact' },
    { key: 'amount', label: 'Amount', value: '₹5,000', confidence: 99, category: 'financial' },
    { key: 'paymentMode', label: 'Payment Mode', value: 'Online (UPI)', confidence: 93, category: 'financial' },
    { key: 'panNumber', label: 'PAN Number', value: 'ABCDE1234F', confidence: 91, category: 'identity' },
    { key: 'ngoName', label: 'NGO Name', value: 'Helping Hands Foundation', confidence: 96, category: 'identity' },
    { key: 'ngoRegistrationNumber', label: 'NGO Reg. No.', value: '12345/2020', confidence: 84, category: 'metadata' },
  ],
  notion: {
    titleFrom: ['donorName', 'donor', 'name'],
    dateFrom: ['date', 'receiptDate', 'donationDate'],
    properties: [
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'PAN', type: 'rich_text', from: PAN },
    ],
  },
  validate(fields) {
    const warnings: string[] = [];
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const idText = fieldValue(fields, PAN);
    const pan = idText?.replace(/\s+/g, '').toUpperCase();
    // Form 10BD takes the donor's Aadhaar instead of PAN, so an Aadhaar here is a donor ID too.
    const aadhaar = (idText && AADHAAR_ID.test(idText)) || fields.some(f => isAadhaarField(f) && /\d{4}/.test(f.value));

    if (pan && !PAN_IN_TEXT.test(pan) && !aadhaar) {
      warnings.push(`PAN "${pan}" doesn't match the format ABCDE1234F. Please check it.`);
    }
    if (amount !== null && amount > CASH_LIMIT && CASH.test(fieldValue(fields, PAYMENT_MODE) ?? '')) {
      warnings.push(`Cash donations above ${rupees(CASH_LIMIT)} don't get the 80G tax deduction (${rupees(amount)} recorded in cash). Please check the payment mode, and ask for a cheque or online transfer next time.`);
    }
    if (amount !== null && amount > CASH_LIMIT && !pan && !aadhaar) {
      warnings.push(`Compliance: donations above ${rupees(CASH_LIMIT)} normally need the donor's PAN or Aadhaar (${rupees(amount)} recorded, no PAN).`);
    }
    return warnings;
  },
};
