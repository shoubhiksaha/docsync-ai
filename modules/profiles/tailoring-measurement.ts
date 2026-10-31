import { parseNumber } from '@/core/text';
import { isMobileNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const CUSTOMER = ['customerName', 'customer', 'name'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'mobileNo'];
const TOTAL = ['totalAmount', 'total', 'amount', 'stitchingCharges'];
const ADVANCE = ['advance', 'advancePaid', 'advanceAmount'];
const BALANCE = ['balance', 'balanceDue', 'baki', 'balanceAmount'];
const ORDER_DATE = ['date', 'orderDate', 'bookingDate'];
const TRIAL = ['trialDate', 'fittingDate'];
const DELIVERY = ['deliveryDate', 'readyDate', 'dueDate'];
/** The common body measurements, recorded as separate fields (inches). */
const MEASUREMENTS: [label: string, aliases: string[]][] = [
  ['Chest', ['chest', 'bust', 'chhati']],
  ['Waist', ['waist', 'kamar']],
  ['Hip', ['hip', 'hips', 'seat']],
  ['Shoulder', ['shoulder', 'tira', 'kandha']],
  ['Sleeve', ['sleeve', 'sleeveLength', 'bazu', 'aastin']],
  ['Length', ['length', 'lambai', 'kurtaLength', 'shirtLength']],
  ['Neck', ['neck', 'gala', 'collar']],
];
/** Plausible range for a body measurement in inches (a short sleeve to a full-length gown). */
const MIN_INCHES = 4;
const MAX_INCHES = 70;
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

export const tailoringMeasurement: DocumentProfile = {
  id: 'tailoring-measurement',
  title: 'Tailoring Measurement Books',
  documentName: 'Tailoring Order & Measurements',
  description: 'Digitize customer measurements, fabric details, trial and delivery dates, and payments for boutique management.',
  group: 'shops',
  sheetTab: 'Tailoring_Measurements',
  sheetTitle: 'DocSync — Tailoring Measurement Books',
  sampleDocument: { href: '/samples/tailoring-measurement.jpg', fileName: 'Sample_Tailoring_Measurement.jpg' },
  duplicateKey: 'orderNumber',
  translations: {
    hi: {
      title: 'दर्ज़ी नाप पुस्तिका',
      documentName: 'दर्ज़ी ऑर्डर और नाप पर्ची',
      description: 'नाप पुस्तिका से ग्राहक के नाप, कपड़े का विवरण, ट्रायल और डिलीवरी की तारीख और हिसाब डिजिटल करें।',
    },
  },
  extraction: {
    context: 'This is a page or slip from an Indian tailor\'s or boutique\'s measurement book (नाप पुस्तिका / order book), usually printed with an order number and filled in by hand. Record the order number, order date, customer name and phone, garment type (e.g. blouse, kurta, salwar suit, shirt, pant), and each common measurement in inches as its own field: chest/bust (छाती), waist (कमर), hip/seat (हिप), shoulder (तीरा/कंधा), sleeve (बाजू/आस्तीन), length (लंबाई) and neck (गला). Put any other measurements (e.g. armhole, bottom, thigh, mori) into one "Measurements" field as "name value" separated by semicolons. Also record fabric details, trial date, delivery date, total amount, advance (एडवांस) and balance (बाकी).',
    priorityFields: ['Order Number', 'Date', 'Customer Name', 'Phone', 'Garment Type', 'Chest', 'Waist', 'Measurements', 'Delivery Date', 'Total Amount'],
  },
  mockFields: [
    { key: 'orderNumber', label: 'Order Number', value: '1527', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '20-10-2026', confidence: 92, category: 'date' },
    { key: 'customerName', label: 'Customer Name', value: 'Neha Agarwal', confidence: 91, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 41890', confidence: 89, category: 'contact' },
    { key: 'garmentType', label: 'Garment Type', value: 'Salwar Suit (Kurta + Salwar)', confidence: 88, category: 'other' },
    { key: 'chest', label: 'Chest', value: '36', confidence: 90, category: 'other' },
    { key: 'waist', label: 'Waist', value: '30', confidence: 90, category: 'other' },
    { key: 'shoulder', label: 'Shoulder', value: '14.5', confidence: 86, category: 'other' },
    { key: 'measurements', label: 'Measurements', value: 'Hip 38; Sleeve 11; Length 42; Neck 7; Armhole 16; Salwar length 39; Mori 14', confidence: 80, category: 'other' },
    { key: 'deliveryDate', label: 'Delivery Date', value: '02-11-2026', confidence: 88, category: 'date' },
    { key: 'totalAmount', label: 'Total Amount', value: '₹1,450', confidence: 94, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹500', confidence: 93, category: 'financial' },
  ],
  notion: {
    titleFrom: CUSTOMER,
    dateFrom: ORDER_DATE,
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL },
      { name: 'Phone', type: 'rich_text', from: PHONE },
      { name: 'Delivery Date', type: 'date', from: DELIVERY },
    ],
  },
  derive(fields) {
    if (findField(fields, BALANCE)) return fields;
    const total = parseNumber(fieldValue(fields, TOTAL));
    const advance = parseNumber(fieldValue(fields, ADVANCE));
    if (total === null || advance === null) return fields;
    return [...fields, { key: 'balance', label: 'Balance', value: String(total - advance), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    for (const [label, aliases] of MEASUREMENTS) {
      const inches = parseNumber(fieldValue(fields, aliases));
      if (inches !== null && (inches < MIN_INCHES || inches > MAX_INCHES)) {
        warnings.push(`${label} ${inches} is outside the usual ${MIN_INCHES}–${MAX_INCHES} inches. Was it written in cm, or misread? Please check it.`);
      }
    }

    const total = parseNumber(fieldValue(fields, TOTAL));
    const advance = parseNumber(fieldValue(fields, ADVANCE));
    const balance = parseNumber(fieldValue(fields, BALANCE));
    if (total !== null && advance !== null) {
      if (advance > total) {
        warnings.push(`Advance (${rupees(advance)}) is more than the total (${rupees(total)}). Please check the amounts.`);
      } else if (balance !== null && Math.abs(total - advance - balance) > 1) {
        warnings.push(`Balance (${rupees(balance)}) doesn't equal total ${rupees(total)} − advance ${rupees(advance)} = ${rupees(total - advance)}.`);
      }
    }

    const orderRaw = fieldValue(fields, ORDER_DATE);
    const trialRaw = fieldValue(fields, TRIAL);
    const deliveryRaw = fieldValue(fields, DELIVERY);
    const order = dateMs(orderRaw);
    const trial = dateMs(trialRaw);
    const delivery = dateMs(deliveryRaw);
    if (order !== null && delivery !== null && delivery < order) {
      warnings.push(`Delivery date (${deliveryRaw}) is before the order date (${orderRaw}). Check the dates.`);
    }
    if (trial !== null && delivery !== null && trial > delivery) {
      warnings.push(`Trial date (${trialRaw}) is after the delivery date (${deliveryRaw}). Check the dates.`);
    }

    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }
    return warnings;
  },
};
