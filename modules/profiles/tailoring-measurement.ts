import { parseNumber } from '@/core/text';
import { amountValue, isMobileNumber, parseIndianDate, rupees, signedAmount } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RuleWarning } from './types';

const CUSTOMER = ['customerName', 'customer', 'name'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'mobileNo'];
const TOTAL = ['totalAmount', 'total', 'amount', 'stitchingCharges'];
const ADVANCE = ['advance', 'advancePaid', 'advanceAmount'];
const BALANCE = ['balance', 'balanceDue', 'baki', 'balanceAmount'];
const ORDER_DATE = ['date', 'orderDate', 'bookingDate'];
const TRIAL = ['trialDate', 'fittingDate'];
const DELIVERY = ['deliveryDate', 'readyDate', 'dueDate'];
/** The common body measurements, recorded as separate fields (inches, or cm when written). */
const MEASUREMENTS: string[][] = [
  ['chest', 'bust', 'chhati'],
  ['waist', 'kamar'],
  ['hip', 'hips', 'seat'],
  ['shoulder', 'tira', 'kandha'],
  ['sleeve', 'sleeveLength', 'bazu', 'aastin'],
  ['length', 'lambai', 'kurtaLength', 'shirtLength'],
  ['neck', 'gala', 'collar'],
];
/** Plausible range for a body measurement in inches (a short sleeve to a full-length gown), and the same in cm. */
const MIN_INCHES = 4;
const MAX_INCHES = 70;
const MIN_CM = 10;
const MAX_CM = 180;
/** A unit written after the number: "96 cm", "96 सेमी", "96 से.मी.", "960 mm". */
const CM = /\d\s*(?:cms?|centimet(?:er|re)s?|सेमी|से\.\s?मी\.?)/i;
const MM = /\d\s*(?:mm|मिमी|मि\.\s?मी\.?)/i;

/** A measurement in inches, or in cm when a metric unit is written ("96 cm"; "960 mm" → 96 cm). */
function measurement(text: string | undefined): { value: number; cm: boolean } | null {
  const n = parseNumber(text);
  if (n === null) return null;
  if (MM.test(text ?? '')) return { value: n / 10, cm: true };
  return { value: n, cm: CM.test(text ?? '') };
}

export const tailoringMeasurement: DocumentProfile = {
  id: 'tailoring-measurement',
  title: 'Tailoring Measurement Books',
  documentName: 'Tailoring Order & Measurements',
  description: 'Keep each order in your sheet: measurements, fabric, trial and delivery dates, and payments.',
  group: 'shops',
  sheetTab: 'Tailoring_Measurements',
  sheetTitle: 'DocSync — Tailoring Measurement Books',
  sampleDocument: { href: '/samples/tailoring-measurement.jpg', fileName: 'Sample_Tailoring_Measurement.jpg' },
  duplicateKey: 'orderNumber',
  translations: {
    hi: {
      title: 'दर्ज़ी नाप पुस्तिका',
      documentName: 'दर्ज़ी ऑर्डर और नाप पर्ची',
      description: 'नाप पुस्तिका से ग्राहक के नाप, कपड़े का विवरण, ट्रायल और डिलीवरी की तारीख और हिसाब पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is a page or slip from an Indian tailor\'s or boutique\'s measurement book (नाप पुस्तिका / order book), usually printed with an order number and filled in by hand. Record the order number, order date, customer name and phone, garment type (e.g. blouse, kurta, salwar suit, shirt, pant), and each common measurement in inches as its own field: chest/bust (छाती), waist (कमर), hip/seat (हिप), shoulder (तीरा/कंधा), sleeve (बाजू/आस्तीन), length (लंबाई) and neck (गला). Put any other measurements (e.g. armhole, bottom, thigh, mori) into one "Measurements" field as "name value" separated by semicolons. Also record fabric details, trial date, delivery date, total amount, advance (एडवांस) and balance (बाकी).',
    priorityFields: ['Order Number', 'Date', 'Customer Name', 'Phone', 'Garment Type', 'Chest', 'Waist', 'Measurements', 'Fabric', 'Trial Date', 'Delivery Date', 'Total Amount', 'Advance', 'Balance'],
  },
  // The values on public/samples/tailoring-measurement.jpg, each common measurement in its own field as the context asks.
  mockFields: [
    { key: 'orderNumber', label: 'Order Number', value: '1527', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '20/10/2026', confidence: 92, category: 'date' },
    { key: 'customerName', label: 'Customer Name', value: 'Neha Agarwal', confidence: 91, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 41890', confidence: 89, category: 'contact' },
    { key: 'garmentType', label: 'Garment Type', value: 'Salwar Suit (Kurta + Salwar)', confidence: 88, category: 'other' },
    { key: 'chest', label: 'Chest', value: '36', confidence: 90, category: 'other' },
    { key: 'waist', label: 'Waist', value: '30', confidence: 90, category: 'other' },
    { key: 'hip', label: 'Hip', value: '38', confidence: 89, category: 'other' },
    { key: 'shoulder', label: 'Shoulder', value: '14.5', confidence: 86, category: 'other' },
    { key: 'sleeve', label: 'Sleeve', value: '11', confidence: 88, category: 'other' },
    { key: 'length', label: 'Length', value: '42', confidence: 88, category: 'other' },
    { key: 'neck', label: 'Neck', value: '7 (front)', confidence: 84, category: 'other' },
    { key: 'measurements', label: 'Measurements', value: 'Armhole 16; Salwar length 39; Mori 14', confidence: 80, category: 'other' },
    { key: 'notes', label: 'Notes', value: 'Side slit, piping on gala', confidence: 78, category: 'other' },
    { key: 'fabric', label: 'Fabric', value: 'Own cotton print 2.5 m + lining', confidence: 82, category: 'other' },
    { key: 'trialDate', label: 'Trial Date', value: '29/10/2026', confidence: 87, category: 'date' },
    { key: 'deliveryDate', label: 'Delivery Date', value: '02/11/2026', confidence: 88, category: 'date' },
    { key: 'totalAmount', label: 'Total Amount', value: '₹1,450', confidence: 94, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹500', confidence: 93, category: 'financial' },
    { key: 'balance', label: 'Balance', value: '₹950', confidence: 92, category: 'financial' },
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
    const total = amountValue(fieldValue(fields, TOTAL));
    const advance = amountValue(fieldValue(fields, ADVANCE));
    if (total === null || advance === null) return fields;
    return [...fields, { key: 'balance', label: 'Balance', value: String(total - advance), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    for (const aliases of MEASUREMENTS) {
      const field = findField(fields, aliases);
      const size = measurement(field?.value);
      const [min, max] = size?.cm ? [MIN_CM, MAX_CM] : [MIN_INCHES, MAX_INCHES];
      if (!field || !size || (size.value >= min && size.value <= max)) continue;
      // Written in cm: checked in cm, so the only question left is a misread.
      warnings.push(size.cm
        ? { code: 'tailoring.measurementCm', field: field.key, params: { name: field.label, value: field.value.trim(), min, max } }
        : { code: 'tailoring.measurement', field: field.key, params: { name: field.label, value: size.value, min, max } });
    }

    const total = amountValue(fieldValue(fields, TOTAL));
    const advance = amountValue(fieldValue(fields, ADVANCE));
    // Paid ahead is a negative balance ("-₹200", "₹200 advance").
    const balance = signedAmount(fieldValue(fields, BALANCE));
    if (total !== null && advance !== null) {
      if (advance > total) {
        warnings.push({ code: 'advanceOver', field: fieldKey(fields, ADVANCE), params: { advance: rupees(advance), total: rupees(total) } });
      } else if (balance !== null && Math.abs(total - advance - balance) > 1) {
        warnings.push({
          code: 'balance',
          field: fieldKey(fields, BALANCE),
          params: { balance: rupees(balance), total: rupees(total), advance: rupees(advance), expected: rupees(total - advance) },
        });
      }
    }

    const orderRaw = fieldValue(fields, ORDER_DATE);
    const trialRaw = fieldValue(fields, TRIAL);
    const deliveryRaw = fieldValue(fields, DELIVERY);
    const order = parseIndianDate(orderRaw)?.time ?? null;
    const trial = parseIndianDate(trialRaw)?.time ?? null;
    const delivery = parseIndianDate(deliveryRaw)?.time ?? null;
    if (order !== null && delivery !== null && delivery < order) {
      warnings.push({ code: 'tailoring.dates', field: fieldKey(fields, DELIVERY), params: { delivery: deliveryRaw ?? '', order: orderRaw ?? '' } });
    }
    if (trial !== null && delivery !== null && trial > delivery) {
      warnings.push({ code: 'tailoring.trial', field: fieldKey(fields, TRIAL), params: { trial: trialRaw ?? '', delivery: deliveryRaw ?? '' } });
    }

    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push({ code: 'phone', field: fieldKey(fields, PHONE), params: { phone } });
    }
    return warnings;
  },
};
