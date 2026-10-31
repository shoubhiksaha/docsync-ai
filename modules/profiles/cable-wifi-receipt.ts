import { parseNumber } from '@/core/text';
import { rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const AMOUNT = ['amount', 'monthlyAmount', 'planAmount', 'subscriptionAmount', 'packAmount'];
const LATE_FEE = ['lateFee', 'lateFine', 'lateCharges', 'penalty'];
const TOTAL = ['totalPaid', 'totalAmount', 'total', 'amountPaid', 'amountReceived'];
const BILLING_MONTH = ['billingMonth', 'billingPeriod', 'month', 'period', 'forMonth'];
const CUSTOMER_ID = ['customerId', 'subscriberId', 'stbNumber', 'vcNumber', 'stbVcNumber', 'accountNumber'];

export const cableWifiReceipt: DocumentProfile = {
  id: 'cable-wifi-receipt',
  title: 'Cable TV / WiFi Collection Receipts',
  documentName: 'Cable TV / WiFi Receipt',
  description: 'Digitize monthly subscription payments collected door-to-door.',
  group: 'community',
  sheetTab: 'Cable_WiFi_Receipts',
  sheetTitle: 'DocSync — Cable TV / WiFi Receipts',
  sampleDocument: { href: '/samples/cable-wifi-receipt.jpg', fileName: 'Sample_Cable_WiFi_Receipt.jpg' },
  duplicateKey: 'receiptNumber',
  translations: {
    hi: {
      title: 'केबल टीवी / वाई-फ़ाई वसूली रसीदें',
      documentName: 'केबल टीवी / वाई-फ़ाई रसीद',
      description: 'घर-घर जाकर लिए गए मासिक भुगतान डिजिटल करें।',
    },
  },
  extraction: {
    context: 'This is an Indian local cable TV or broadband (WiFi) operator\'s monthly collection receipt, usually a small printed receipt book filled in by hand by the collector at the customer\'s door, with labels like "रसीद नं.", "नाम", "माह", "राशि", "लेट फीस" and "कुल". Record the subscriber\'s customer ID or set-top box (STB) / VC number exactly as written, the area or ward, the plan or pack, the billing month or period the payment covers, the monthly amount, any late fee, the total paid, payment mode (cash/UPI) and the collector\'s name.',
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
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    if (amount === null) return fields;
    const lateFee = parseNumber(fieldValue(fields, LATE_FEE)) ?? 0;
    return [...fields, { key: 'totalPaid', label: 'Total Paid', value: String(amount + lateFee), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const lateFee = parseNumber(fieldValue(fields, LATE_FEE)) ?? 0;
    const total = parseNumber(fieldValue(fields, TOTAL));
    if (amount !== null && total !== null) {
      const expected = amount + lateFee;
      if (Math.abs(expected - total) > Math.max(1, expected * 0.01)) {
        warnings.push(`Total paid (${rupees(total)}) doesn't equal amount + late fee (${rupees(amount)} + ${rupees(lateFee)} = ${rupees(expected)}).`);
      }
    }
    if (!fieldValue(fields, BILLING_MONTH)) {
      warnings.push('No billing month found. Please add which month this payment is for, so the subscriber isn\'t asked to pay it twice.');
    }
    return warnings;
  },
};
