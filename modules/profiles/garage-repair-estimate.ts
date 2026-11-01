import { amountOrRate, amountValue, derivedRupees, gstTotal, isGstin, isMobileNumber, isVehicleNumber, moneyClose, rupees } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const CUSTOMER = ['customerName', 'customer', 'name', 'ownerName'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'mobileNo'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'vehicle', 'registrationNumber', 'regNo'];
const GSTIN = ['gstin', 'gstNumber', 'gstNo', 'garageGstin'];
const PARTS_TOTAL = ['partsTotal', 'partsAmount', 'totalParts', 'spareParts'];
const LABOUR = ['labourTotal', 'labour', 'labor', 'labourCharges', 'laborCharges', 'labourAmount'];
const GST = ['gst', 'gstAmount', 'totalGst', 'tax', 'taxAmount', 'cgstSgst'];
const GRAND_TOTAL = ['grandTotal', 'totalAmount', 'total', 'estimateTotal', 'netAmount'];
const DISCOUNT = ['discount', 'discountAmount', 'less', 'lessDiscount'];

/**
 * Parts + labour − discount + GST (CGST and SGST added up; a GST or discount written as a percent
 * worked out on the amount before it), with each part; null when a figure is missing or can't be read.
 */
function expectedTotal(fields: RecordField[]): { parts: number; labour: number; discount: number; gst: number; total: number } | null {
  const parts = amountValue(fieldValue(fields, PARTS_TOTAL));
  const labour = amountValue(fieldValue(fields, LABOUR));
  if (parts === null || labour === null) return null;
  const discountText = fieldValue(fields, DISCOUNT);
  const discount = discountText === undefined ? 0 : amountOrRate(discountText, parts + labour);
  if (discount === null) return null;
  const gst = gstTotal(fields, GST, parts + labour - discount);
  if (gst === null) return null;
  const total = Math.round((parts + labour - discount + (gst ?? 0)) * 100) / 100;
  return { parts, labour, discount, gst: gst ?? 0, total };
}

export const garageRepairEstimate: DocumentProfile = {
  id: 'garage-repair-estimate',
  title: 'Garage Repair Estimates',
  documentName: 'Garage Repair Estimate',
  description: "Turn a mechanic's handwritten estimate into one row: vehicle, spare parts, labour, GST and total.",
  group: 'shops',
  sheetTab: 'Garage_Estimates',
  sheetTitle: 'DocSync — Garage Repair Estimates',
  sampleDocument: { href: '/samples/garage-repair-estimate.jpg', fileName: 'Sample_Garage_Repair_Estimate.jpg' },
  duplicateKey: 'estimateNumber',
  translations: {
    hi: {
      title: 'गैराज मरम्मत अनुमान',
      documentName: 'गैराज मरम्मत एस्टिमेट',
      description: 'मिस्त्री के हाथ से लिखे एस्टिमेट से गाड़ी नंबर, पुर्ज़े, मज़दूरी, GST और कुल रकम पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian motor garage or workshop repair estimate (एस्टिमेट / job card), usually a printed pad filled in by hand. It shows the estimate or job number, date, customer name and phone, vehicle number (e.g. "MH 12 AB 1234" or a BH-series number), make and model, odometer reading in km, a list of spare parts (पार्ट्स / पुर्ज़े) with prices, labour charges (मज़दूरी / लेबर), GST and the garage GSTIN if registered, and the grand total. Put all parts into one "Parts" field as "part – qty – ₹amount" separated by semicolons, and record parts total, labour total, any discount, the GST amount (or CGST and SGST separately, as printed) and grand total as separate fields.',
    priorityFields: ['Estimate Number', 'Date', 'Customer Name', 'Vehicle Number', 'Make Model', 'Odometer', 'Parts', 'Labour Total', 'GST', 'Grand Total'],
  },
  mockFields: [
    { key: 'estimateNumber', label: 'Estimate Number', value: 'EST-1184', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '22-10-2026', confidence: 94, category: 'date' },
    { key: 'customerName', label: 'Customer Name', value: 'Vikas Gupta', confidence: 92, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 43318', confidence: 89, category: 'contact' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'UP 32 KX 4471', confidence: 95, category: 'identity' },
    { key: 'makeModel', label: 'Make Model', value: 'Maruti Suzuki Swift VXi', confidence: 87, category: 'other' },
    { key: 'odometer', label: 'Odometer', value: '48,250 km', confidence: 84, category: 'other' },
    {
      key: 'parts',
      label: 'Parts',
      value: 'Brake pads (front) – 1 set – ₹1,450; Engine oil 5W-30 – 3.5 L – ₹1,680; Oil filter – 1 – ₹320; Air filter – 1 – ₹450',
      confidence: 80,
      category: 'other',
    },
    { key: 'partsTotal', label: 'Parts Total', value: '₹3,900', confidence: 93, category: 'financial' },
    { key: 'labourTotal', label: 'Labour Total', value: '₹1,200', confidence: 92, category: 'financial' },
    { key: 'gst', label: 'GST', value: '₹918', confidence: 88, category: 'financial' },
    { key: 'grandTotal', label: 'Grand Total', value: '₹6,018', confidence: 96, category: 'financial' },
  ],
  notion: {
    titleFrom: VEHICLE,
    dateFrom: ['date', 'estimateDate'],
    properties: [
      { name: 'Amount', type: 'number', from: GRAND_TOTAL },
      { name: 'Vehicle Number', type: 'rich_text', from: VEHICLE },
      { name: 'Party', type: 'rich_text', from: CUSTOMER },
    ],
  },
  derive(fields) {
    if (findField(fields, GRAND_TOTAL)) return fields;
    const expected = expectedTotal(fields);
    if (!expected) return fields;
    return [...fields, { key: 'grandTotal', label: 'Grand Total', value: derivedRupees(expected.total), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const total = amountValue(fieldValue(fields, GRAND_TOTAL));
    const expected = expectedTotal(fields);
    if (total !== null && expected && !moneyClose(total, expected.total)) {
      const { parts, labour, discount, gst } = expected;
      const params = { total: rupees(total), parts: rupees(parts), labour: rupees(labour), gst: rupees(gst), expected: rupees(expected.total) };
      warnings.push(discount
        ? { code: 'garage.totalDiscount', field: fieldKey(fields, GRAND_TOTAL), params: { ...params, discount: rupees(discount) } }
        : { code: 'garage.total', field: fieldKey(fields, GRAND_TOTAL), params });
    }

    const vehicle = fieldValue(fields, VEHICLE);
    if (vehicle && !isVehicleNumber(vehicle)) {
      warnings.push({ code: 'vehicle', field: fieldKey(fields, VEHICLE), params: { vehicle } });
    }

    const gstin = fieldValue(fields, GSTIN)?.replace(/\s+/g, '').toUpperCase();
    if (gstin && !isGstin(gstin)) {
      warnings.push({ code: 'gstin', field: fieldKey(fields, GSTIN), params: { gstin } });
    }

    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push({ code: 'phone', field: fieldKey(fields, PHONE), params: { phone } });
    }
    return warnings;
  },
};
