import { parseNumber } from '@/core/text';
import { rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const TOTAL = ['totalShipments', 'totalParcels', 'totalPackets', 'shipmentCount', 'totalAwbs'];
const DELIVERED = ['delivered', 'deliveredCount', 'shipmentsDelivered', 'parcelsDelivered'];
const UNDELIVERED = ['undelivered', 'undeliveredCount', 'returned', 'undeliveredReturned', 'rto', 'pending'];
const COD_EXPECTED = ['codExpected', 'codAmount', 'totalCod', 'codToCollect', 'codDue'];
const COD_COLLECTED = ['codCollected', 'cashCollected', 'codReceived', 'amountCollected', 'cashDeposited'];

const count = (key: string, label: string, value: number): RecordField =>
  ({ key, label, value: String(value), confidence: 100, category: 'metadata' });

export const courierRunSheet: DocumentProfile = {
  id: 'courier-run-sheet',
  title: 'Local Courier Delivery Run-sheets',
  documentName: 'Delivery Run-sheet',
  description: 'Extract tracking numbers, delivery status, and COD collected from each run-sheet.',
  group: 'transport',
  sheetTab: 'Courier_RunSheets',
  sheetTitle: 'DocSync — Courier Delivery Run-sheets',
  sampleDocument: { href: '/samples/courier-run-sheet.jpg', fileName: 'Sample_Delivery_Run_Sheet.jpg' },
  duplicateKey: 'runSheetNumber',
  translations: {
    hi: {
      title: 'लोकल कूरियर डिलीवरी शीट',
      documentName: 'डिलीवरी रन-शीट',
      description: 'हर रन-शीट से ट्रैकिंग नंबर, डिलीवरी की स्थिति और वसूली गई COD राशि निकालें।',
    },
  },
  extraction: {
    context: 'This is an Indian local courier delivery run-sheet (DRS): one page per delivery person per day, listing many shipments, with handwritten ticks, statuses and Hindi notes like "डिलीवर", "वापस", "घर बंद", "मना किया", "नकद", "हस्ताक्षर". '
      + 'Capture the whole page as ONE record: run-sheet number, date, delivery person, area/route, total shipments, delivered, undelivered/returned, COD expected and COD collected (as written in the totals box). '
      + 'Put every line item into the single "Shipments" field as "AWB – status – COD amount", separated by semicolons (e.g. "SGX123 – Delivered – COD ₹850; SGX124 – Door locked"). Do not record receiver phone numbers or addresses.',
    priorityFields: ['Run-sheet Number', 'Date', 'Delivery Person', 'Area / Route', 'Total Shipments', 'Delivered', 'Undelivered / Returned', 'COD Expected', 'COD Collected', 'Shipments'],
  },
  mockFields: [
    { key: 'runSheetNumber', label: 'Run-sheet Number', value: 'DRS-SMP-1184', confidence: 91, category: 'identity' },
    { key: 'date', label: 'Date', value: '20-10-2026', confidence: 95, category: 'date' },
    { key: 'deliveryPerson', label: 'Delivery Person', value: 'Imran Shaikh', confidence: 84, category: 'identity' },
    { key: 'route', label: 'Area / Route', value: 'Station Road, Gandhi Nagar', confidence: 80, category: 'other' },
    { key: 'totalShipments', label: 'Total Shipments', value: '10', confidence: 96, category: 'metadata' },
    { key: 'delivered', label: 'Delivered', value: '8', confidence: 93, category: 'metadata' },
    { key: 'undelivered', label: 'Undelivered / Returned', value: '2', confidence: 90, category: 'metadata' },
    { key: 'codExpected', label: 'COD Expected', value: '₹3,640', confidence: 92, category: 'financial' },
    { key: 'codCollected', label: 'COD Collected', value: '₹3,640', confidence: 90, category: 'financial' },
    {
      key: 'shipments',
      label: 'Shipments',
      value: 'SGX2610045871 – Delivered – COD ₹850; SGX2610045872 – Delivered; SGX2610045873 – Delivered – COD ₹1,290; '
        + 'SGX2610045874 – Door locked; SGX2610045875 – Delivered; SGX2610045876 – Delivered – COD ₹499; SGX2610045877 – Delivered; '
        + 'SGX2610045878 – Refused; SGX2610045879 – Delivered – COD ₹1,001; SGX2610045880 – Delivered',
      confidence: 78,
      category: 'other',
    },
  ],
  notion: {
    titleFrom: ['deliveryPerson', 'deliveryBoy', 'rider', 'runSheetNumber'],
    dateFrom: ['date', 'runSheetDate'],
    properties: [
      { name: 'Amount', type: 'number', from: COD_COLLECTED },
      { name: 'Quantity', type: 'number', from: TOTAL },
      { name: 'Parcels Delivered', type: 'number', from: DELIVERED },
    ],
  },
  /** Fills in a missing total or undelivered count from the other two. */
  derive(fields) {
    const total = parseNumber(fieldValue(fields, TOTAL));
    const delivered = parseNumber(fieldValue(fields, DELIVERED));
    const undelivered = parseNumber(fieldValue(fields, UNDELIVERED));
    if (delivered === null) return fields;

    if (undelivered === null && total !== null && total >= delivered && !findField(fields, UNDELIVERED)) {
      return [...fields, count('undelivered', 'Undelivered / Returned', total - delivered)];
    }
    if (total === null && undelivered !== null && !findField(fields, TOTAL)) {
      return [...fields, count('totalShipments', 'Total Shipments', delivered + undelivered)];
    }
    return fields;
  },
  validate(fields) {
    const warnings: string[] = [];
    const total = parseNumber(fieldValue(fields, TOTAL));
    const delivered = parseNumber(fieldValue(fields, DELIVERED));
    const undelivered = parseNumber(fieldValue(fields, UNDELIVERED));
    const expected = parseNumber(fieldValue(fields, COD_EXPECTED));
    const collected = parseNumber(fieldValue(fields, COD_COLLECTED));

    if (total !== null && delivered !== null) {
      if (undelivered !== null && delivered + undelivered !== total) {
        warnings.push(`Delivered (${delivered}) + undelivered (${undelivered}) = ${delivered + undelivered}, but total shipments is ${total}. Please check the counts.`);
      } else if (undelivered === null && delivered > total) {
        warnings.push(`Delivered (${delivered}) is more than total shipments (${total}). Please check the counts.`);
      }
    }
    if (expected !== null && collected !== null) {
      const gap = Math.round((expected - collected) * 100) / 100;
      if (gap > 1) {
        warnings.push(`COD collected (${rupees(collected)}) is ${rupees(gap)} short of COD expected (${rupees(expected)}). Check undelivered COD parcels or cash still with the delivery person.`);
      } else if (gap < -1) {
        warnings.push(`COD collected (${rupees(collected)}) is ${rupees(-gap)} more than COD expected (${rupees(expected)}). Please check the amounts.`);
      }
    }
    return warnings;
  },
};
